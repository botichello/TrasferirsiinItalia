"""Configuration for data, model, and training.

Everything needed to reproduce a run (and to reload a trained model for live
inference) lives in one dataclass that serializes to/from JSON alongside the
checkpoint.
"""

from __future__ import annotations

import dataclasses
import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class TFTConfig:
    # --- data ---
    tickers: list[str] = field(default_factory=lambda: ["AAPL"])
    provider: str = "yahoo"       # "yahoo" (stocks/ETFs) or "coinbase" (crypto, 24/7)
    interval: str = "1h"          # bar interval: 1m 5m 15m 1h 1d ...
    lookback: str = "730d"        # history to fetch for training
    encoder_length: int = 96      # past bars fed to the encoder
    horizon: int = 12             # future bars predicted by the decoder

    # --- model ---
    hidden_size: int = 64
    lstm_layers: int = 1
    attention_heads: int = 4
    dropout: float = 0.1
    quantiles: list[float] = field(default_factory=lambda: [0.1, 0.25, 0.5, 0.75, 0.9])

    # --- training ---
    batch_size: int = 64
    max_epochs: int = 30
    learning_rate: float = 1e-3
    gradient_clip: float = 1.0
    early_stopping_patience: int = 5
    val_fraction: float = 0.15
    seed: int = 42
    warmup_fraction: float = 0.05   # linear LR warmup, then cosine decay
    ema_decay: float = 0.995        # exponential moving average of weights
    ensemble_size: int = 1          # deep ensemble members (different seeds)

    # --- data conditioning ---
    robust_scaling: bool = True         # median/IQR instead of mean/std
    vol_normalize_target: bool = True   # train on vol-scaled returns
    embargo: int | None = None          # bars between train and val (default: horizon)

    # Conformal (CQR) offsets fitted on validation after training; applied
    # at prediction time so quantile bands carry a coverage guarantee.
    conformal: dict | None = None

    # --- realtime ---
    refresh_seconds: int = 60
    online_learning: bool = False   # fine-tune on freshly closed bars while live
    online_lr: float = 1e-4
    online_steps: int = 8

    # Filled in by the feature pipeline at fit time; stored so live inference
    # builds exactly the same tensors as training did.
    observed_features: list[str] = field(default_factory=list)
    known_features: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        # Prediction code sorts quantile outputs to enforce non-crossing, so
        # the label list must be ascending for columns to match labels.
        self.quantiles = sorted(self.quantiles)

    @property
    def n_quantiles(self) -> int:
        return len(self.quantiles)

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(dataclasses.asdict(self), indent=2))

    @classmethod
    def load(cls, path: str | Path) -> "TFTConfig":
        raw = json.loads(Path(path).read_text())
        known = {f.name for f in dataclasses.fields(cls)}
        return cls(**{k: v for k, v in raw.items() if k in known})


def artifacts_dir(config: TFTConfig, root: str | Path = "artifacts") -> Path:
    name = f"{'-'.join(config.tickers)}_{config.interval}"
    return Path(root) / name
