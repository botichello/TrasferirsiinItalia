"""Score past live forecasts against what actually happened.

Every live update is appended to `predictions.jsonl`. Once a forecast's
horizon has elapsed ("matured"), the realized close can be compared to the
predicted quantile band. This module joins the two and reports the metrics
that tell you whether to keep trusting the model:

- **band coverage** — how often the realized price landed inside the outer
  quantile band. Should track the nominal probability (e.g. ~80%); a large
  drop means the market regime moved and the model needs retraining.
- **directional accuracy** — how often the median called the sign of the move.
- **median error** — mean absolute percentage error of the median forecast.
- **signal performance** — hypothetical friction-free return of acting on
  each non-FLAT signal and holding to the horizon.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd


def read_records(path: str | Path) -> list[dict]:
    path = Path(path)
    if not path.exists():
        return []
    records = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            records.append(json.loads(line))
    return records


def evaluate_records(records: list[dict], closes: pd.Series,
                     tolerance: pd.Timedelta, fee_bps: float = 0.0) -> dict:
    """Join forecasts with realized closes and compute health metrics.

    `closes` must be indexed by tz-aware timestamps. A forecast is scored
    when a realized bar exists within `tolerance` of its horizon end.
    `fee_bps` charges a per-side cost on signal returns (round trip = 2x).
    """
    fee = fee_bps * 1e-4
    closes = closes.sort_index()
    rows = []
    for rec in records:
        t_end = pd.Timestamp(rec["horizon_timestamps"][-1])
        idx = closes.index.get_indexer([t_end], method="nearest")
        if idx[0] < 0 or abs(closes.index[idx[0]] - t_end) > tolerance:
            continue  # not matured yet (or a data gap)
        realized = float(closes.iloc[idx[0]])
        q = np.asarray(rec["quantiles"])
        end = np.asarray(rec["price_quantiles"][-1])
        med = float(end[int(np.abs(q - 0.5).argmin())])
        lo, hi = float(end[int(q.argmin())]), float(end[int(q.argmax())])
        last_close = float(rec["last_close"])
        action = rec.get("signal", {}).get("action", "FLAT")
        direction = {"LONG": 1, "SHORT": -1}.get(action, 0)
        size = rec.get("signal", {}).get("size_vol_target",
                                         rec.get("signal", {}).get("size", 1.0))
        rows.append({
            "generated_at": rec["generated_at"],
            "horizon_end": t_end.isoformat(),
            "last_close": last_close,
            "median": med,
            "lo": lo,
            "hi": hi,
            "realized": realized,
            "in_band": lo <= realized <= hi,
            "dir_ok": (np.sign(med - last_close) == np.sign(realized - last_close))
                      and realized != last_close,
            "abs_pct_err": abs(realized - med) / realized,
            "action": action,
            "signal_return": direction * (realized / last_close - 1)
                             - 2 * fee * abs(direction),
            "sized_return": size * (direction * (realized / last_close - 1)
                                    - 2 * fee * abs(direction)),
        })

    summary: dict = {"n_forecasts": len(records), "n_matured": len(rows)}
    if rows:
        nominal = None
        if records:
            q = sorted(records[-1]["quantiles"])
            nominal = float(q[-1] - q[0])
        moved = [r for r in rows if r["realized"] != r["last_close"]]
        trades = [r for r in rows if r["action"] != "FLAT"]
        summary.update({
            "band_coverage": float(np.mean([r["in_band"] for r in rows])),
            "nominal_coverage": nominal,
            "directional_accuracy": (float(np.mean([r["dir_ok"] for r in moved]))
                                     if moved else None),
            "median_abs_pct_error": float(np.mean([r["abs_pct_err"] for r in rows])),
            "trades": len(trades),
            "trade_hit_rate": (float(np.mean([r["signal_return"] > 0 for r in trades]))
                               if trades else None),
            "trade_total_return": float(sum(r["signal_return"] for r in trades)),
        })
        # sized paper-P&L: vol-target-sized positions, held to horizon,
        # chronological equity curve with max drawdown
        chron = sorted(rows, key=lambda r: r["horizon_end"])
        equity = np.cumsum([r["sized_return"] for r in chron])
        peak = np.maximum.accumulate(np.concatenate([[0.0], equity]))[1:]
        summary["sized_total_return"] = float(equity[-1])
        summary["max_drawdown"] = float((equity - peak).min())
    return {"summary": summary, "rows": rows}


def evaluate_file(jsonl_path: str | Path, closes: pd.Series,
                  tolerance: pd.Timedelta, fee_bps: float = 0.0,
                  ticker: str | None = None) -> dict:
    records = read_records(jsonl_path)
    if ticker is not None:
        records = [r for r in records if r.get("ticker") == ticker]
    return evaluate_records(records, closes, tolerance, fee_bps=fee_bps)
