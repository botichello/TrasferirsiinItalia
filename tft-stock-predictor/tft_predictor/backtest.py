"""Walk-forward backtest of the quantile forecasts and the derived signal."""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd
import torch
from torch.utils.data import DataLoader

import torch.nn as nn

from .config import TFTConfig
from .conformal import apply_conformal, select_offsets
from .data import FeatureScaler, WindowDataset
from .model import QuantileLoss
from .predict import trading_signal

log = logging.getLogger(__name__)

# bars per year for annualization (crypto trades 24/7; equity hours differ —
# treat these as order-of-magnitude annualizers, not precision constants)
PERIODS_PER_YEAR = {"1m": 525_600, "5m": 105_120, "15m": 35_040,
                    "30m": 17_520, "1h": 8_760, "6h": 1_460, "1d": 365}


def annualized_sharpe(returns: np.ndarray, periods_per_year: float) -> float | None:
    if len(returns) < 2 or returns.std() == 0:
        return None
    return float(returns.mean() / returns.std() * np.sqrt(periods_per_year))


def trade_stats(pnl: np.ndarray, trades_per_year: float) -> dict:
    """Risk metrics for a series of per-trade returns."""
    if len(pnl) == 0:
        return {"annualized_sharpe": None, "annualized_sortino": None,
                "max_drawdown": 0.0}
    equity = np.cumsum(pnl)
    peak = np.maximum.accumulate(np.concatenate([[0.0], equity]))[1:]
    downside = pnl[pnl < 0]
    sortino = None
    if len(pnl) >= 2 and len(downside) and downside.std() > 0:
        sortino = float(pnl.mean() / downside.std() * np.sqrt(trades_per_year))
    return {
        "annualized_sharpe": annualized_sharpe(pnl, trades_per_year),
        "annualized_sortino": sortino,
        "max_drawdown": float((equity - peak).min()),
    }


@torch.no_grad()
def collect_predictions(model: nn.Module, loader, config: TFTConfig,
                        ticker_id: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """Model quantiles and targets over a loader, in real return space with
    conformal applied — i.e. exactly what the deployed system would output."""
    model.eval()
    preds, targets = [], []
    offsets = select_offsets(config.conformal, ticker_id)
    for batch in loader:
        out = model(batch["observed"], batch["known_enc"],
                    batch["known_dec"], batch["static"])
        scale = batch["scale"].view(-1, 1, 1).numpy()
        p = np.sort(out["prediction"].numpy(), axis=-1) * scale
        if offsets:
            p = apply_conformal(p, offsets)
        preds.append(p)
        targets.append(batch["target"].numpy() * batch["scale"].view(-1, 1).numpy())
    return np.concatenate(preds), np.concatenate(targets)


def simulate_trades(pred: np.ndarray, true: np.ndarray, config: TFTConfig,
                    edge_threshold: float, fee: float) -> np.ndarray:
    """Non-overlapping trade PnL using the live signal rule."""
    position = np.array([
        {"LONG": 1, "SHORT": -1}.get(
            trading_signal(pred[i], config.quantiles, edge_threshold)["action"], 0)
        for i in range(len(pred))])
    end_true = true[:, -1]
    pnl, i = [], 0
    while i < len(position):
        if position[i] != 0:
            pnl.append(position[i] * end_true[i] - 2 * fee)
            i += config.horizon
        else:
            i += 1
    return np.asarray(pnl)


def tune_edge_threshold(model: nn.Module, loader, config: TFTConfig,
                        grid: tuple = (0.0, 0.00025, 0.0005, 0.001,
                                       0.0015, 0.002, 0.003)) -> float:
    """Pick the signal threshold that maximizes fee-adjusted validation PnL.

    Tuned on the same embargoed validation split as the conformal offsets;
    ties (including the all-FLAT case) keep the more conservative threshold.
    """
    pred, true = collect_predictions(model, loader, config)
    fee = config.fee_bps * 1e-4
    best_thr, best_score = config.edge_threshold, -np.inf
    for thr in sorted(grid, reverse=True):     # prefer conservative on ties
        pnl = simulate_trades(pred, true, config, thr, fee)
        score = float(pnl.sum()) if len(pnl) else 0.0
        if score > best_score:
            best_score, best_thr = score, thr
    log.info("tuned edge_threshold=%.5f (val PnL %.5f)", best_thr, best_score)
    return best_thr


@torch.no_grad()
def backtest(model: nn.Module, scaler: FeatureScaler,
             config: TFTConfig, features: pd.DataFrame, ticker_id: int = 0,
             holdout_fraction: float | None = None,
             edge_threshold: float | None = None,
             fee_bps: float | None = None) -> dict:
    """Evaluate on the chronological tail of `features`.

    `holdout_fraction` defaults to `config.val_fraction`; keep it <= that
    value so the evaluated windows were never seen during training.
    `fee_bps` (default `config.fee_bps`) charges a per-side transaction
    cost on every trade — a round trip costs 2x.

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

    if config.objective == "sharpe":
        return _backtest_positions(model, loader, config, fee_bps)

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
        # evaluate in real return space, exactly as deployed: de-normalize
        # by the origin's vol scale and apply the conformal correction
        scale = batch["scale"].view(-1, 1, 1).numpy()
        p = np.sort(out["prediction"].numpy(), axis=-1) * scale
        offsets = select_offsets(config.conformal, ticker_id)
        if offsets:
            p = apply_conformal(p, offsets)
        preds.append(p)
        targets.append(batch["target"].numpy() * batch["scale"].view(-1, 1).numpy())
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
    thr = config.edge_threshold if edge_threshold is None else edge_threshold
    fee = (config.fee_bps if fee_bps is None else fee_bps) * 1e-4
    pnl = simulate_trades(pred, true, config, thr, fee)
    trades_per_year = PERIODS_PER_YEAR.get(config.interval, 8_760) / config.horizon

    results = {
        "objective": "quantile",
        "windows": len(ds),
        "quantile_loss": total_loss / max(count, 1),
        "interval_coverage": float(covered.mean()),
        "nominal_coverage": float(q[hi_i] - q[lo_i]),
        "inner_coverage": inner_coverage,
        "inner_nominal": (float(q[len(q) - 2] - q[1]) if len(q) >= 4 else None),
        "directional_accuracy": float(direction_hit.mean()) if nonzero.any() else None,
        "fee_bps_per_side": (config.fee_bps if fee_bps is None else fee_bps),
        "edge_threshold": thr,
        "trades": int(len(pnl)),
        "total_return": float(pnl.sum()) if len(pnl) else 0.0,
        "hit_rate": float((pnl > 0).mean()) if len(pnl) else None,
        "avg_return_per_trade": float(pnl.mean()) if len(pnl) else None,
        **trade_stats(pnl, trades_per_year),
    }
    log.info("backtest: %s", results)
    return results


@torch.no_grad()
def _backtest_positions(model: nn.Module, loader, config: TFTConfig,
                        fee_bps: float | None) -> dict:
    """Backtest a Sharpe-objective (position head) model.

    The model's first-step position for each consecutive window forms the
    position series; PnL is position x next-bar return minus fees on
    position changes. Reported in real (non-normalized) returns.
    """
    model.eval()
    positions, step_returns = [], []
    for batch in loader:
        out = model(batch["observed"], batch["known_enc"],
                    batch["known_dec"], batch["static"])
        positions.append(out["prediction"].squeeze(-1)[:, 0].numpy())
        # first-step return, de-normalized to real units
        step_returns.append((batch["target"][:, 0] * batch["scale"]).numpy())
    pos = np.concatenate(positions)
    ret = np.concatenate(step_returns)

    fee = (config.fee_bps if fee_bps is None else fee_bps) * 1e-4
    trades = np.abs(np.diff(np.concatenate([[0.0], pos])))
    pnl = pos * ret - fee * trades
    ppy = PERIODS_PER_YEAR.get(config.interval, 8_760)
    equity = np.cumsum(pnl)
    peak = np.maximum.accumulate(np.concatenate([[0.0], equity]))[1:]

    nonzero = ret != 0
    results = {
        "objective": "sharpe",
        "windows": int(len(pos)),
        "fee_bps_per_side": (config.fee_bps if fee_bps is None else fee_bps),
        "total_return": float(pnl.sum()),
        "annualized_sharpe": annualized_sharpe(pnl, ppy),
        "max_drawdown": float((equity - peak).min()),
        "avg_abs_position": float(np.abs(pos).mean()),
        "turnover_per_bar": float(trades.mean()),
        "hit_rate": (float((np.sign(pos[nonzero]) == np.sign(ret[nonzero])).mean())
                     if nonzero.any() else None),
    }
    log.info("backtest(sharpe): %s", results)
    return results
