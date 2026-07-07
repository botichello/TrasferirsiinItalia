"""Feature drift detection via the Population Stability Index.

At train time, decile bin edges are fitted per observed feature on the
training data and persisted next to the model. Live, the recent feature
window is binned against those edges; PSI measures how far the live
distribution has moved:

    PSI = sum_bins (actual_pct - expected_pct) * ln(actual_pct / expected_pct)

Industry rules of thumb: < 0.1 stable, 0.1-0.25 moderate shift, > 0.25 major
shift. Major shift on any feature sets `retrain_recommended` — the concrete
trigger the auto-retrain loop (and the human reading the dashboard) acts on.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

PSI_MODERATE = 0.10
PSI_MAJOR = 0.25
_N_BINS = 10
_EPS = 1e-4


def fit_reference(df: pd.DataFrame, features: list[str]) -> dict:
    """Decile bin edges per feature, fitted on training data."""
    ref = {}
    for col in features:
        edges = np.quantile(df[col].dropna(),
                            np.linspace(0, 1, _N_BINS + 1)).tolist()
        ref[col] = edges
    return ref


def psi(series: pd.Series, edges: list[float]) -> float:
    """PSI of `series` against decile-binned reference (expected 10%/bin)."""
    edges = np.asarray(edges, dtype=float)
    inner = edges[1:-1]
    counts = np.bincount(np.searchsorted(inner, series.dropna().to_numpy()),
                         minlength=_N_BINS).astype(float)
    if counts.sum() == 0:
        return 0.0
    actual = np.clip(counts / counts.sum(), _EPS, None)
    expected = np.full(_N_BINS, 1.0 / _N_BINS)
    return float(np.sum((actual - expected) * np.log(actual / expected)))


def drift_report(recent: pd.DataFrame, reference: dict) -> dict:
    """PSI per feature over the recent window, plus the retrain flag."""
    per_feature = {col: round(psi(recent[col], edges), 4)
                   for col, edges in reference.items() if col in recent}
    if not per_feature:
        return {"max_psi": 0.0, "mean_psi": 0.0, "drifted": [],
                "retrain_recommended": False, "per_feature": {}}
    values = list(per_feature.values())
    drifted = sorted((c for c, v in per_feature.items() if v > PSI_MAJOR),
                     key=lambda c: -per_feature[c])
    return {
        "max_psi": round(max(values), 4),
        "mean_psi": round(float(np.mean(values)), 4),
        "drifted": drifted,
        "retrain_recommended": bool(drifted),
        "per_feature": per_feature,
    }


def save_reference(ref: dict, path: str | Path) -> None:
    Path(path).write_text(json.dumps(ref))


def load_reference(path: str | Path) -> dict | None:
    path = Path(path)
    if not path.exists():
        return None
    return json.loads(path.read_text())
