"""Windowing, scaling, and torch Dataset construction."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch.utils.data import ConcatDataset, Dataset

from ..config import TFTConfig
from .features import KNOWN_FEATURES, OBSERVED_FEATURES


class FeatureScaler:
    """Per-feature standardization with persistable parameters.

    With `robust=True` (recommended for fat-tailed financial features) the
    center is the median and the scale is IQR/1.349 — the σ-equivalent for a
    normal distribution — so outlier bars can't dominate the statistics. The
    attribute names stay `mean`/`std` for artifact compatibility; they hold
    center/scale.
    """

    def __init__(self, mean: dict[str, float] | None = None,
                 std: dict[str, float] | None = None):
        self.mean = mean or {}
        self.std = std or {}

    def fit(self, df: pd.DataFrame, columns: list[str],
            robust: bool = True) -> "FeatureScaler":
        for col in columns:
            series = df[col]
            if robust:
                center = float(series.median())
                iqr = float(series.quantile(0.75) - series.quantile(0.25))
                scale = iqr / 1.349
            else:
                center = float(series.mean())
                scale = float(series.std())
            if not scale > 1e-12:
                scale = float(series.std())
            self.mean[col] = center
            self.std[col] = scale if scale > 1e-12 else 1.0
        return self

    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        for col, mu in self.mean.items():
            if col in out.columns:
                out[col] = (out[col] - mu) / self.std[col]
        return out

    def inverse_target(self, values: np.ndarray) -> np.ndarray:
        if "target" not in self.mean:
            return values
        return values * self.std["target"] + self.mean["target"]

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps({"mean": self.mean, "std": self.std}, indent=2))

    @classmethod
    def load(cls, path: str | Path) -> "FeatureScaler":
        raw = json.loads(Path(path).read_text())
        return cls(raw["mean"], raw["std"])


class WindowDataset(Dataset):
    """Sliding windows over one ticker's feature frame.

    Each sample:
      observed:  (encoder_length, n_observed)   past features
      known_enc: (encoder_length, n_known)      calendar features, past
      known_dec: (horizon, n_known)             calendar features, future
      static:    ()                             ticker id
      target:    (horizon,)                     cumulative log return from origin
                                                (divided by `scale` when
                                                vol-normalization is on)
      scale:     ()                             multiply predictions/targets by
                                                this to recover real returns
    """

    def __init__(self, df: pd.DataFrame, config: TFTConfig, ticker_id: int,
                 with_targets: bool = True):
        self.config = config
        self.ticker_id = ticker_id
        self.index = df.index

        self.observed = torch.tensor(
            df[OBSERVED_FEATURES].to_numpy(dtype=np.float32))
        self.known = torch.tensor(df[KNOWN_FEATURES].to_numpy(dtype=np.float32))
        step_returns = torch.tensor(df["target"].to_numpy(dtype=np.float32))
        # target[t] holds the log return over (t, t+1]; cumulative sums are
        # formed per-window below.
        self.step_returns = step_returns
        if config.vol_normalize_target and "target_scale" in df.columns:
            self.scale = torch.tensor(
                df["target_scale"].to_numpy(dtype=np.float32))
        else:
            self.scale = torch.ones(len(df))

        E, H = config.encoder_length, config.horizon
        n = len(df)
        if with_targets:
            # window origin o uses rows [o-E+1, o] for the encoder and needs
            # step returns at rows o .. o+H-1.
            self.origins = [o for o in range(E - 1, n - H)
                            if not torch.isnan(step_returns[o:o + H]).any()]
        else:
            self.origins = [n - 1] if n >= E else []

    def __len__(self) -> int:
        return len(self.origins)

    def __getitem__(self, i: int) -> dict[str, torch.Tensor]:
        o = self.origins[i]
        E, H = self.config.encoder_length, self.config.horizon
        item = {
            "observed": self.observed[o - E + 1: o + 1],
            "known_enc": self.known[o - E + 1: o + 1],
            "static": torch.tensor(self.ticker_id, dtype=torch.long),
        }
        item["scale"] = self.scale[o]
        if o + H < len(self.step_returns) + 1 and not torch.isnan(
                self.step_returns[o:o + H]).any():
            item["target"] = (torch.cumsum(self.step_returns[o:o + H], dim=0)
                              / self.scale[o])
            item["known_dec"] = self.known[o + 1: o + 1 + H]
        return item


def build_datasets(frames: dict[str, pd.DataFrame], config: TFTConfig,
                   scaler: FeatureScaler | None = None
                   ) -> tuple[ConcatDataset, ConcatDataset, FeatureScaler]:
    """Chronological train/val split per ticker, shared scaler fit on train.

    An embargo gap (default: one horizon) is left between the last training
    target and the first validation target, so serially-correlated labels
    can't leak across the split (López de Prado's purged/embargoed CV).
    """
    embargo = config.embargo if config.embargo is not None else config.horizon
    split_frames: dict[str, tuple[pd.DataFrame, pd.DataFrame]] = {}
    for ticker, df in frames.items():
        cut = int(len(df) * (1 - config.val_fraction))
        # validation windows keep encoder context but their first target
        # starts `embargo` bars after the last training row
        va_full = df.iloc[max(0, cut + embargo - (config.encoder_length - 1)):]
        split_frames[ticker] = (df.iloc[:cut], va_full)

    if scaler is None:
        scaler = FeatureScaler()
        train_concat = pd.concat([tr for tr, _ in split_frames.values()])
        scaler.fit(train_concat, OBSERVED_FEATURES, robust=config.robust_scaling)

    train_sets, val_sets = [], []
    for tid, ticker in enumerate(config.tickers):
        tr, va_full = split_frames[ticker]
        train_sets.append(WindowDataset(scaler.transform(tr), config, tid))
        val_sets.append(WindowDataset(scaler.transform(va_full), config, tid))
    return ConcatDataset(train_sets), ConcatDataset(val_sets), scaler
