"""Conformalized quantile regression (Romano, Patterson & Candès, 2019).

Neural quantile heads are often miscalibrated — too narrow in turbulent
regimes, too wide in calm ones. CQR fixes this with a distribution-free
post-hoc correction: on held-out data, measure how far outside each
predicted interval the realized values fell, and shift the interval bounds
by the empirical (1-α) quantile of those conformity scores. The corrected
intervals carry a finite-sample marginal coverage guarantee.

Offsets are fitted per horizon step and per symmetric quantile pair, in
real (de-normalized) return space, and stored in the model config so they
travel with the checkpoint.
"""

from __future__ import annotations

import numpy as np
import torch
from torch.utils.data import DataLoader


def conformal_offsets(pred: np.ndarray, true: np.ndarray,
                      quantiles: list[float]) -> dict:
    """Fit CQR offsets.

    pred: (N, H, Q) predicted quantiles, real return space, columns ascending.
    true: (N, H) realized values.
    Returns {"pairs": [[lo_i, hi_i], ...], "offsets": [[H floats], ...]}.
    """
    q = np.asarray(quantiles)
    n = len(pred)
    pairs, offsets = [], []
    for i in range(len(q) // 2):
        j = len(q) - 1 - i
        if q[i] >= 0.5 or abs((q[i] + q[j]) - 1.0) > 1e-6:
            continue  # only symmetric pairs form a two-sided interval
        alpha = 1.0 - (q[j] - q[i])
        scores = np.maximum(pred[:, :, i] - true, true - pred[:, :, j])  # (N, H)
        level = min(1.0, (1.0 - alpha) * (1.0 + 1.0 / n))
        offsets.append(np.quantile(scores, level, axis=0).tolist())
        pairs.append([int(i), int(j)])
    return {"pairs": pairs, "offsets": offsets}


def apply_conformal(pred: np.ndarray, conf: dict) -> np.ndarray:
    """Apply fitted offsets to predictions of shape (..., H, Q); offsets may
    be negative (bands narrow when the model was over-wide). Columns are
    re-sorted afterwards to keep quantiles non-crossing."""
    pred = pred.copy()
    for (i, j), off in zip(conf["pairs"], conf["offsets"]):
        off = np.asarray(off)
        pred[..., i] -= off
        pred[..., j] += off
    return np.sort(pred, axis=-1)


def select_offsets(conf: dict | None, ticker_id: int) -> dict | None:
    """Pick the offsets for a ticker: per-ticker when available, else the
    pooled fit; transparently handles the legacy single-dict format."""
    if not conf:
        return None
    if "pairs" in conf:          # legacy pooled-only format
        return conf
    return (conf.get("per_ticker", {}).get(str(ticker_id))
            or conf.get("pooled"))


@torch.no_grad()
def fit_conformal(model, loader: DataLoader, quantiles: list[float]) -> dict:
    """Collect model predictions over a calibration loader (validation set)
    and fit offsets in real return space.

    Offsets are fitted both pooled and per ticker: multi-asset models
    calibrated only on pooled scores are right on average but drift per
    asset (a quieter asset ends over-covered, a wilder one under-covered).
    """
    model.eval()
    preds, trues, tids = [], [], []
    for batch in loader:
        out = model(batch["observed"], batch["known_enc"],
                    batch["known_dec"], batch["static"])
        scale = batch["scale"].view(-1, 1, 1)
        preds.append(np.sort((out["prediction"] * scale).numpy(), axis=-1))
        trues.append((batch["target"] * batch["scale"].view(-1, 1)).numpy())
        tids.append(batch["static"].numpy())
    pred = np.concatenate(preds)
    true = np.concatenate(trues)
    tid = np.concatenate(tids)
    result = {"pooled": conformal_offsets(pred, true, quantiles),
              "per_ticker": {}}
    for t in np.unique(tid):
        mask = tid == t
        if mask.sum() >= 50:     # enough scores for a stable quantile
            result["per_ticker"][str(int(t))] = conformal_offsets(
                pred[mask], true[mask], quantiles)
    return result
