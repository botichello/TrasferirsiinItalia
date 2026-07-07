"""Walk-forward (rolling-origin) evaluation with periodic retraining.

The single-split backtest trains once and tests once; a deployed system
retrains as history accrues. Walk-forward simulates that honestly: the
history is cut into consecutive test folds, and for each fold the model is
retrained from scratch on data strictly before the fold (with the usual
embargoed validation inside that past), then evaluated deployment-style —
conformal offsets, tuned threshold, and fees included — on the fold only.
No fold's data ever influences the model that trades it.
"""

from __future__ import annotations

import dataclasses
import logging
import tempfile

import numpy as np
import pandas as pd
from torch.utils.data import DataLoader

from .backtest import (
    PERIODS_PER_YEAR,
    collect_predictions,
    simulate_trades,
    trade_stats,
)
from .config import TFTConfig
from .data import WindowDataset
from .training import train

log = logging.getLogger(__name__)


def walkforward(config: TFTConfig, features: pd.DataFrame,
                n_folds: int = 4, min_train_fraction: float = 0.4,
                fee_bps: float | None = None) -> dict:
    """Rolling-origin evaluation on one ticker's feature frame."""
    if config.objective != "quantile":
        raise ValueError("walkforward currently supports quantile-objective "
                         "configs (bands + signal rule)")
    ticker = config.tickers[0]
    n = len(features)
    first_test = int(n * min_train_fraction)
    bounds = np.linspace(first_test, n, n_folds + 1, dtype=int)
    fee = (config.fee_bps if fee_bps is None else fee_bps) * 1e-4

    folds = []
    all_pnl, covered, dir_hits, dir_total = [], [], 0, 0
    for k in range(n_folds):
        lo, hi = bounds[k], bounds[k + 1]
        train_df = features.iloc[:lo]
        # test windows get encoder context from the past but every target
        # lies inside the fold
        test_df = features.iloc[lo - config.encoder_length + 1: hi]

        fold_cfg = dataclasses.replace(
            config, tickers=[ticker], conformal=None)
        with tempfile.TemporaryDirectory() as tmp:
            model, hist = train(fold_cfg, frames={ticker: train_df},
                                artifacts=tmp)
        # scaler was fitted inside train(); refit identically for transform
        from .data import build_datasets
        _, _, scaler = build_datasets({ticker: train_df}, fold_cfg)

        ds = WindowDataset(scaler.transform(test_df), fold_cfg, 0)
        if len(ds) == 0:
            continue
        loader = DataLoader(ds, batch_size=fold_cfg.batch_size)
        pred, true = collect_predictions(model, loader, fold_cfg)
        pnl = simulate_trades(pred, true, fold_cfg,
                              fold_cfg.edge_threshold, fee)

        q = np.asarray(fold_cfg.quantiles)
        end_pred, end_true = pred[:, -1, :], true[:, -1]
        in_band = ((end_true >= end_pred[:, 0])
                   & (end_true <= end_pred[:, -1]))
        nz = end_true != 0
        med_i = int(np.abs(q - 0.5).argmin())
        hits = int((np.sign(end_pred[nz, med_i])
                    == np.sign(end_true[nz])).sum())

        folds.append({
            "fold": k,
            "test_start": str(features.index[lo]),
            "windows": len(ds),
            "val_loss": hist["ensemble_val_loss"],
            "coverage": float(in_band.mean()),
            "directional_accuracy": float(hits / max(nz.sum(), 1)),
            "edge_threshold": fold_cfg.edge_threshold,
            "trades": int(len(pnl)),
            "fold_return": float(pnl.sum()) if len(pnl) else 0.0,
        })
        log.info("fold %d/%d: %s", k + 1, n_folds, folds[-1])
        all_pnl.extend(pnl.tolist())
        covered.extend(in_band.tolist())
        dir_hits += hits
        dir_total += int(nz.sum())

    pnl = np.asarray(all_pnl)
    tpy = PERIODS_PER_YEAR.get(config.interval, 8_760) / config.horizon
    return {
        "objective": config.objective,
        "n_folds": len(folds),
        "windows": int(sum(f["windows"] for f in folds)),
        "coverage": float(np.mean(covered)) if covered else None,
        "nominal_coverage": float(max(config.quantiles) - min(config.quantiles)),
        "directional_accuracy": (dir_hits / dir_total) if dir_total else None,
        "fee_bps_per_side": (config.fee_bps if fee_bps is None else fee_bps),
        "trades": int(len(pnl)),
        "total_return": float(pnl.sum()) if len(pnl) else 0.0,
        **trade_stats(pnl, tpy),
        "folds": folds,
    }
