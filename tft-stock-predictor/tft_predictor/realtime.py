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
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import torch

from .config import TFTConfig
from .data import FeatureScaler, WindowDataset, get_client
from .data.features import build_features
from .model import QuantileLoss, TemporalFusionTransformer
from .predict import predict_from_frame

log = logging.getLogger(__name__)


class RealtimePredictor:
    def __init__(self, model: TemporalFusionTransformer, scaler: FeatureScaler,
                 config: TFTConfig, ticker: str | None = None,
                 out_dir: str | Path = "artifacts"):
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

        features = build_features(closed)
        result = predict_from_frame(
            self.model, self.scaler, self.config, features, self.ticker_id)
        self._emit(result)
        return result

    def run(self, max_updates: int | None = None) -> None:
        """Blocking loop: poll every `refresh_seconds` until interrupted."""
        self.warm_start()
        updates = 0
        while True:
            try:
                result = self.poll()
            except ConnectionError as err:
                log.warning("poll failed, will retry: %s", err)
                result = None
            if result is not None:
                updates += 1
                if max_updates is not None and updates >= max_updates:
                    return
            time.sleep(self.config.refresh_seconds)

    # ------------------------------------------------------------------
    def _online_update(self, closed: pd.DataFrame) -> None:
        """A few gradient steps on the freshest fully-labeled windows."""
        cfg = self.config
        features = build_features(closed)
        needed = cfg.encoder_length + cfg.horizon + cfg.online_steps
        if len(features) < needed:
            return
        ds = WindowDataset(self.scaler.transform(features.iloc[-needed - cfg.horizon:]),
                           cfg, self.ticker_id)
        if len(ds) == 0:
            return
        self.model.train()
        indices = list(range(len(ds)))[-cfg.online_steps:]
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
        }
        with self.out_path.open("a") as fh:
            fh.write(json.dumps(record) + "\n")
