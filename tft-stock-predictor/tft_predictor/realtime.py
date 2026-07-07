"""Real-time prediction engine.

Polls Yahoo Finance for fresh bars, recomputes features, and re-issues the
quantile forecast whenever a new bar closes. Optionally fine-tunes the model
online on newly closed bars (a few gradient steps on the freshest windows),
so the predictor adapts intraday without a full retrain.

Each update is printed as a console report and appended as JSON lines to
`predictions.jsonl` in the artifacts directory, so downstream consumers
(dashboards, execution engines) can tail the file.
"""

from __future__ import annotations

import json
import logging
import random
import threading
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import torch

import requests

from .config import TFTConfig
from .conformal import ACIState
from .data import FeatureScaler, WindowDataset, get_client
from .data.features import build_features, interval_to_timedelta
from .drift import drift_report, load_reference
from .evaluation import evaluate_file
from .model import QuantileLoss, TemporalFusionTransformer
from .predict import predict_from_frame

log = logging.getLogger(__name__)


def run_many(engines: list["RealtimePredictor"], refresh_seconds: int,
             max_updates: int | None = None) -> None:
    """Round-robin poll several engines (one per ticker) in one process.

    Each engine keeps its own bar clock, ACI state, and health; they share
    the process, the output file, and one polling cadence. `max_updates`
    counts forecasts across all engines (useful for tests/smoke runs).
    """
    for engine in engines:
        engine.warm_start()
    updates = 0
    while True:
        for engine in engines:
            try:
                result = engine.poll()
            except ConnectionError as err:
                log.warning("%s poll failed, will retry: %s",
                            engine.ticker, err)
                result = None
            if result is not None:
                updates += 1
                if max_updates is not None and updates >= max_updates:
                    return
        time.sleep(refresh_seconds)


class RealtimePredictor:
    def __init__(self, model: TemporalFusionTransformer, scaler: FeatureScaler,
                 config: TFTConfig, ticker: str | None = None,
                 out_dir: str | Path = "artifacts",
                 webhook_url: str | None = None,
                 auto_retrain: bool = False,
                 retrain_every_bars: int | None = None):
        self.model = model
        self.scaler = scaler
        self.config = config
        self.ticker = ticker or config.tickers[0]
        self.ticker_id = (config.tickers.index(self.ticker)
                          if self.ticker in config.tickers else 0)
        self.client = get_client(config.provider)
        self.out_path = Path(out_dir) / "predictions.jsonl"
        self.out_path.parent.mkdir(parents=True, exist_ok=True)
        self.last_bar: pd.Timestamp | None = None
        self.history: pd.DataFrame | None = None
        self.last_record: dict | None = None
        self.recent: deque[dict] = deque(maxlen=50)
        self._lock = threading.Lock()  # guards state read by the dashboard
        self.webhook_url = webhook_url
        self._last_action: str | None = None
        self._health_cache: tuple | None = None
        self.aci_path = self.out_path.parent / "aci.json"
        self.aci = self._load_aci()
        self.drift_ref = load_reference(self.out_path.parent / "drift.json")
        self.last_drift: dict | None = None
        self.auto_retrain = auto_retrain
        self.retrain_every_bars = retrain_every_bars
        self.last_retrain: dict | None = None
        self._bars_since_train = 0
        self._retraining = False
        self._retrain_cooldown = 0
        self._optimizer = None
        if config.online_learning:
            self._optimizer = torch.optim.AdamW(
                model.parameters(), lr=config.online_lr)
            self._criterion = QuantileLoss(config.quantiles)

    # ------------------------------------------------------------------
    def warm_start(self) -> None:
        """Fetch enough history to fill the encoder before going live."""
        range_ = {"1m": "7d", "2m": "60d", "5m": "60d", "15m": "60d",
                  "30m": "60d", "1h": "730d", "1d": "max"}.get(self.config.interval, "60d")
        self.history = self.client.fetch(
            self.ticker, interval=self.config.interval, range_=range_)
        log.info("warm start: %d bars of %s history", len(self.history), self.ticker)

    def poll(self) -> dict | None:
        """Fetch latest bars; if a new bar closed, refresh the forecast."""
        fresh = self.client.latest(self.ticker, interval=self.config.interval)
        if self.history is None:
            self.history = fresh
        else:
            self.history = pd.concat([self.history, fresh])
            self.history = self.history[~self.history.index.duplicated(keep="last")]
            self.history = self.history.sort_index()

        # The most recent bar may still be forming; predict from closed bars.
        closed = self.history.iloc[:-1] if len(self.history) > 1 else self.history
        newest = closed.index[-1]
        if self.last_bar is not None and newest <= self.last_bar:
            return None  # no new closed bar yet

        if self.config.online_learning and self.last_bar is not None:
            self._online_update(closed)
        self.last_bar = newest
        if self.config.adaptive_conformal:
            self._update_aci(closed)

        features = build_features(closed)
        if self.drift_ref:
            window = features.iloc[-2 * self.config.encoder_length:]
            with self._lock:
                self.last_drift = drift_report(window, self.drift_ref)
            if self.last_drift["retrain_recommended"]:
                log.warning("%s: feature drift detected (max PSI %.2f: %s) — "
                            "retrain recommended", self.ticker,
                            self.last_drift["max_psi"],
                            ", ".join(self.last_drift["drifted"][:3]))
        result = predict_from_frame(
            self.model, self.scaler, self.config, features, self.ticker_id,
            aci_expand=(self.aci.expand if self.config.adaptive_conformal
                        else 0.0))
        self._emit(result)
        self._maybe_start_retrain()
        return result

    def run(self, max_updates: int | None = None) -> None:
        """Blocking loop: poll every `refresh_seconds` until interrupted."""
        run_many([self], self.config.refresh_seconds, max_updates)

    # ------------------------------------------------------------------
    def _online_update(self, closed: pd.DataFrame) -> None:
        """Gradient steps on the freshest fully-labeled windows, mixed with
        replayed historical windows so intraday adaptation doesn't
        catastrophically forget older regimes (experience replay)."""
        cfg = self.config
        features = build_features(closed)
        if len(features) < cfg.encoder_length + cfg.horizon + 1:
            return
        ds = WindowDataset(self.scaler.transform(features), cfg, self.ticker_id)
        if len(ds) == 0:
            return
        self.model.train()
        fresh = list(range(len(ds)))[-cfg.online_steps:]
        older = range(0, max(0, len(ds) - cfg.online_steps))
        replay = random.sample(older, min(len(older), cfg.online_steps))
        indices = fresh + replay
        random.shuffle(indices)
        for i in indices:
            item = ds[i]
            self._optimizer.zero_grad()
            out = self.model(item["observed"].unsqueeze(0),
                             item["known_enc"].unsqueeze(0),
                             item["known_dec"].unsqueeze(0),
                             item["static"].unsqueeze(0))
            loss = self._criterion(out["prediction"], item["target"].unsqueeze(0))
            loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), cfg.gradient_clip)
            self._optimizer.step()
        self.model.eval()
        log.info("online update: %d steps, last loss %.6f", len(indices), loss.item())

    def _emit(self, result: dict) -> None:
        sig = result["signal"]
        med_i = int(min(range(len(result["quantiles"])),
                        key=lambda i: abs(result["quantiles"][i] - 0.5)))
        horizon_end = result["timestamps"][-1]
        print(
            f"[{datetime.now(timezone.utc):%H:%M:%S}Z] {self.ticker} "
            f"close={result['last_close']:.2f} (bar {result['last_bar_time']:%H:%M}) | "
            f"→ {horizon_end:%m-%d %H:%M}: "
            f"median={result['price'][-1][med_i]:.2f} "
            f"[{result['price'][-1][0]:.2f} … {result['price'][-1][-1]:.2f}] | "
            f"signal={sig['action']} exp={sig['expected_return']:+.4f} "
            f"conf={sig['confidence']:.2f}",
            flush=True,
        )
        record = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "ticker": self.ticker,
            "last_bar_time": result["last_bar_time"].isoformat(),
            "last_close": result["last_close"],
            "quantiles": result["quantiles"],
            "horizon_timestamps": [ts.isoformat() for ts in result["timestamps"]],
            "price_quantiles": result["price"].tolist(),
            "signal": result["signal"],
            "variable_importance": result["variable_importance"],
        }
        with self.out_path.open("a") as fh:
            fh.write(json.dumps(record) + "\n")
        self._maybe_alert(record)
        with self._lock:
            self.last_record = record
            self.recent.append({
                "generated_at": record["generated_at"],
                "last_bar_time": record["last_bar_time"],
                "last_close": record["last_close"],
                "median_end": float(result["price"][-1][med_i]),
                "lo_end": float(result["price"][-1][0]),
                "hi_end": float(result["price"][-1][-1]),
                "signal": result["signal"],
            })

    def _maybe_alert(self, record: dict) -> None:
        """POST the forecast to the webhook when the signal changes."""
        action = record["signal"]["action"]
        changed = self._last_action is not None and action != self._last_action
        self._last_action = action
        if not (self.webhook_url and changed):
            return
        try:
            requests.post(self.webhook_url, json={"event": "signal_change",
                                                  **record}, timeout=5)
            log.info("webhook alert sent: signal → %s", action)
        except requests.RequestException as err:
            log.warning("webhook alert failed: %s", err)

    # ------------------------------------------------------------------
    def _maybe_start_retrain(self) -> None:
        """Kick off a background retrain when drift or age says so."""
        self._bars_since_train += 1
        if self._retrain_cooldown > 0:
            self._retrain_cooldown -= 1
        if not self.auto_retrain or self._retraining or self._retrain_cooldown:
            return
        drifted = bool(self.last_drift
                       and self.last_drift["retrain_recommended"])
        aged = (self.retrain_every_bars is not None
                and self._bars_since_train >= self.retrain_every_bars)
        if not (drifted or aged):
            return
        reason = "drift" if drifted else "age"
        self._retraining = True
        threading.Thread(target=self._retrain_now, args=(reason,),
                         name=f"retrain-{self.ticker}", daemon=True).start()

    def _retrain_now(self, reason: str) -> None:
        """Retrain on current history; hot-swap only if the candidate's
        validation loss doesn't regress vs the running model on the same
        split. Runs on a worker thread; polling continues on the old model
        until the swap."""
        import dataclasses
        import shutil
        import tempfile

        from .data import build_datasets
        from .training import evaluate, load_artifacts, make_criterion, train
        try:
            log.info("%s: auto-retrain started (%s)", self.ticker, reason)
            with self._lock:
                closed = (self.history.iloc[:-1] if len(self.history) > 1
                          else self.history).copy()
            frames = {self.ticker: build_features(closed)}
            cand_cfg = dataclasses.replace(
                self.config, tickers=[self.ticker], conformal=None)

            with tempfile.TemporaryDirectory() as tmp:
                _, hist = train(cand_cfg, frames=frames, artifacts=tmp)
                cand_dir = next(Path(tmp).iterdir())
                cand_val = hist["ensemble_val_loss"]

                # gate: current model on the candidate's validation split
                _, val_ds, _ = build_datasets(frames, self.config,
                                              scaler=self.scaler)
                from torch.utils.data import DataLoader
                current_val = evaluate(
                    self.model, DataLoader(val_ds, batch_size=64),
                    make_criterion(self.config))
                accepted = cand_val <= current_val * 1.02
                event = {"reason": reason, "candidate_val": round(cand_val, 6),
                         "current_val": round(current_val, 6),
                         "accepted": accepted,
                         "at": datetime.now(timezone.utc).isoformat()}
                if accepted:
                    art_dir = self.out_path.parent
                    for f in cand_dir.iterdir():
                        shutil.copy2(f, art_dir / f.name)
                    new_model, new_scaler, new_config = load_artifacts(art_dir)
                    with self._lock:
                        self.model = new_model
                        self.scaler = new_scaler
                        self.config.conformal = new_config.conformal
                        self.config.edge_threshold = new_config.edge_threshold
                        self.drift_ref = load_reference(art_dir / "drift.json")
                        self._bars_since_train = 0
                    log.info("%s: auto-retrain ACCEPTED (val %.6f -> %.6f)",
                             self.ticker, current_val, cand_val)
                else:
                    log.info("%s: auto-retrain rejected (val %.6f vs %.6f)",
                             self.ticker, cand_val, current_val)
            self.last_retrain = event
        except Exception:  # noqa: BLE001 - a failed retrain must not kill live
            log.exception("%s: auto-retrain failed", self.ticker)
        finally:
            self._retraining = False
            self._retrain_cooldown = max(2 * self.config.horizon, 24)

    def _load_aci(self) -> ACIState:
        if self.aci_path.exists():
            raw = json.loads(self.aci_path.read_text())
            return ACIState.from_dict(raw.get(self.ticker))
        return ACIState()

    def _save_aci(self) -> None:
        raw = (json.loads(self.aci_path.read_text())
               if self.aci_path.exists() else {})
        raw[self.ticker] = self.aci.as_dict()
        self.aci_path.write_text(json.dumps(raw, indent=2))

    def _update_aci(self, closed: pd.DataFrame) -> None:
        """Score forecasts that matured since the last update and adapt the
        band expansion — misses widen future bands, hits narrow them."""
        if not self.out_path.exists():
            return
        tolerance = interval_to_timedelta(self.config.interval) / 2
        rows = evaluate_file(self.out_path, closed["close"], tolerance,
                             ticker=self.ticker)["rows"]
        alpha = 1.0 - (max(self.config.quantiles) - min(self.config.quantiles))
        fresh = sorted((r for r in rows
                        if r["generated_at"] > self.aci.processed_through),
                       key=lambda r: r["generated_at"])
        for row in fresh:
            self.aci.update(row["in_band"], alpha, self.config.aci_gamma)
            self.aci.processed_through = row["generated_at"]
        if fresh:
            self._save_aci()
            log.info("ACI: %d matured forecasts scored, expand now %+.3f",
                     len(fresh), self.aci.expand)

    def health(self) -> dict | None:
        """Score matured past forecasts against realized closes (cached
        until predictions.jsonl or the bar clock moves)."""
        if self.history is None or not self.out_path.exists():
            return None
        stat = self.out_path.stat()
        key = (stat.st_mtime_ns, stat.st_size, self.last_bar)
        if self._health_cache is not None and self._health_cache[0] == key:
            return self._health_cache[1]["summary"]
        from .backtest import PERIODS_PER_YEAR
        tolerance = interval_to_timedelta(self.config.interval) / 2
        tpy = (PERIODS_PER_YEAR.get(self.config.interval, 8_760)
               / self.config.horizon)
        result = evaluate_file(self.out_path, self.history["close"],
                               tolerance, fee_bps=self.config.fee_bps,
                               ticker=self.ticker, trades_per_year=tpy)
        self._health_cache = (key, result)
        return result["summary"]

    def ledger(self, limit: int = 200) -> list[dict]:
        """Chronological matured-forecast ledger for the dashboard chart."""
        if self.health() is None or self._health_cache is None:
            return []
        rows = sorted(self._health_cache[1]["rows"],
                      key=lambda r: r["horizon_end"])[-limit:]
        return [{"t": r["horizon_end"],
                 "r": round(r["sized_return"], 6),
                 "in_band": bool(r["in_band"])} for r in rows]

    def snapshot(self, history_bars: int = 180) -> dict:
        """JSON-serializable state for the dashboard."""
        with self._lock:
            record = self.last_record
            recent = list(self.recent)
        base = {
            "ticker": self.ticker,
            "interval": self.config.interval,
            "provider": self.config.provider,
            "refresh_seconds": self.config.refresh_seconds,
            "online_learning": self.config.online_learning,
            "server_time": datetime.now(timezone.utc).isoformat(),
        }
        if record is None or self.history is None:
            return {**base, "status": "warming_up"}
        closed = self.history.iloc[:-1] if len(self.history) > 1 else self.history
        tail = closed.iloc[-history_bars:]
        return {
            **base,
            "status": "live",
            "history": [[int(ts.timestamp() * 1000), float(c)]
                        for ts, c in zip(tail.index, tail["close"])],
            "forecast": {
                "generated_at": record["generated_at"],
                "last_bar_time": record["last_bar_time"],
                "last_close": record["last_close"],
                "timestamps": [int(pd.Timestamp(t).timestamp() * 1000)
                               for t in record["horizon_timestamps"]],
                "quantiles": record["quantiles"],
                "price": record["price_quantiles"],
            },
            "signal": record["signal"],
            "variable_importance": record.get("variable_importance", {}),
            "health": self.health(),
            "aci": (self.aci.as_dict()
                    if self.config.adaptive_conformal else None),
            "drift": self.last_drift,
            "ledger": self.ledger(),
            "retrain": {"auto": self.auto_retrain,
                        "in_progress": self._retraining,
                        "bars_since_train": self._bars_since_train,
                        "last": self.last_retrain},
            "recent": recent,
        }
