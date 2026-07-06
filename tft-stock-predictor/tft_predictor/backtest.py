"""Walk-forward backtest of the quantile forecasts and the derived signal."""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd
import torch
from torch.utils.data import DataLoader

from .config import TFTConfig
from .data import FeatureScaler, WindowDataset
from .model import QuantileLoss, TemporalFusionTransformer
from .predict import trading_signal

log = logging.getLogger(__name__)


@torch.no_grad()
def backtest(model: TemporalFusionTransformer, scaler: FeatureScaler,
             config: TFTConfig, features: pd.DataFrame, ticker_id: int = 0,
             holdout_fraction: float | None = None,
             edge_threshold: float = 0.0005) -> dict:
    """Evaluate on the chronological tail of `features`.

    `holdout_fraction` defaults to `config.val_fraction`; keep it <= that
    value so the evaluated windows were never seen during training.

    Reports quantile loss, coverage of the outer and inner intervals,
    directional accuracy of the median, and a friction-free PnL of the
    same `trading_signal` rule the live engine uses (positions held for
    the full horizon, non-overlapping entries).
    """
    if holdout_fraction is None:
        holdout_fraction = config.val_fraction
    cut = int(len(features) * (1 - holdout_fraction))
    tail = features.iloc[cut - config.encoder_length + 1:]
    ds = WindowDataset(scaler.transform(tail), config, ticker_id)
    if len(ds) == 0:
        raise ValueError("holdout too short for a single window")
    loader = DataLoader(ds, batch_size=config.batch_size)

    criterion = QuantileLoss(config.quantiles)
    q = np.asarray(config.quantiles)
    lo_i, hi_i, med_i = int(q.argmin()), int(q.argmax()), int(np.abs(q - 0.5).argmin())

    model.eval()
    preds, targets = [], []
    total_loss, count = 0.0, 0
    for batch in loader:
        out = model(batch["observed"], batch["known_enc"],
                    batch["known_dec"], batch["static"])
        total_loss += criterion(out["prediction"], batch["target"]).item() * len(batch["static"])
        count += len(batch["static"])
        preds.append(np.sort(out["prediction"].numpy(), axis=-1))
        targets.append(batch["target"].numpy())
    pred = np.concatenate(preds)        # (N, H, Q) cumulative log returns
    true = np.concatenate(targets)      # (N, H)

    end_pred, end_true = pred[:, -1, :], true[:, -1]
    covered = (end_true >= end_pred[:, lo_i]) & (end_true <= end_pred[:, hi_i])
    nonzero = end_true != 0
    direction_hit = np.sign(end_pred[nonzero, med_i]) == np.sign(end_true[nonzero])

    inner_coverage = None
    if len(config.quantiles) >= 4:
        in_lo, in_hi = 1, len(config.quantiles) - 2
        inner = (end_true >= end_pred[:, in_lo]) & (end_true <= end_pred[:, in_hi])
        inner_coverage = float(inner.mean())

    # Non-overlapping strategy using the exact live signal rule.
    position = np.array([
        {"LONG": 1, "SHORT": -1}.get(
            trading_signal(pred[i], config.quantiles, edge_threshold)["action"], 0)
        for i in range(len(pred))])
    pnl, i = [], 0
    while i < len(position):
        if position[i] != 0:
            pnl.append(position[i] * end_true[i])
            i += config.horizon      # hold for the horizon, no overlap
        else:
            i += 1
    pnl = np.asarray(pnl)

    results = {
        "windows": len(ds),
        "quantile_loss": total_loss / max(count, 1),
        "interval_coverage": float(covered.mean()),
        "nominal_coverage": float(q[hi_i] - q[lo_i]),
        "inner_coverage": inner_coverage,
        "inner_nominal": (float(q[len(q) - 2] - q[1]) if len(q) >= 4 else None),
        "directional_accuracy": float(direction_hit.mean()) if nonzero.any() else None,
        "trades": int(len(pnl)),
        "total_return": float(pnl.sum()) if len(pnl) else 0.0,
        "hit_rate": float((pnl > 0).mean()) if len(pnl) else None,
        "avg_return_per_trade": float(pnl.mean()) if len(pnl) else None,
    }
    log.info("backtest: %s", results)
    return results
