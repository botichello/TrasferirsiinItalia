"""Training loop with early stopping and checkpointing."""

from __future__ import annotations

import logging
from pathlib import Path

import torch
from torch.utils.data import DataLoader, Dataset

from .config import TFTConfig, artifacts_dir
from .data import FeatureScaler, build_datasets, get_client
from .data.features import KNOWN_FEATURES, OBSERVED_FEATURES, build_features
from .model import QuantileLoss, TemporalFusionTransformer

log = logging.getLogger(__name__)


def fetch_training_frames(config: TFTConfig) -> dict:
    client = get_client(config.provider)
    frames = {}
    for ticker in config.tickers:
        ohlcv = client.fetch(ticker, interval=config.interval, range_=config.lookback)
        frames[ticker] = build_features(ohlcv)
        log.info("%s: %d bars → %d feature rows", ticker, len(ohlcv), len(frames[ticker]))
    return frames


def train(config: TFTConfig, frames: dict | None = None,
          artifacts: str | Path = "artifacts") -> tuple[TemporalFusionTransformer, dict]:
    torch.manual_seed(config.seed)
    config.observed_features = list(OBSERVED_FEATURES)
    config.known_features = list(KNOWN_FEATURES)

    if frames is None:
        frames = fetch_training_frames(config)
    train_ds, val_ds, scaler = build_datasets(frames, config)
    log.info("train windows: %d, val windows: %d", len(train_ds), len(val_ds))

    train_loader = DataLoader(train_ds, batch_size=config.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=config.batch_size)

    model = TemporalFusionTransformer(config)
    criterion = QuantileLoss(config.quantiles)
    optimizer = torch.optim.AdamW(model.parameters(), lr=config.learning_rate)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, factor=0.5, patience=2)

    out_dir = artifacts_dir(config, artifacts)
    out_dir.mkdir(parents=True, exist_ok=True)
    best_val = float("inf")
    best_epoch = -1
    history = {"train_loss": [], "val_loss": []}

    for epoch in range(config.max_epochs):
        model.train()
        total, count = 0.0, 0
        for batch in train_loader:
            optimizer.zero_grad()
            out = model(batch["observed"], batch["known_enc"],
                        batch["known_dec"], batch["static"])
            loss = criterion(out["prediction"], batch["target"])
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), config.gradient_clip)
            optimizer.step()
            total += loss.item() * len(batch["static"])
            count += len(batch["static"])
        train_loss = total / max(count, 1)

        val_loss = evaluate(model, val_loader, criterion)
        scheduler.step(val_loss)
        history["train_loss"].append(train_loss)
        history["val_loss"].append(val_loss)
        log.info("epoch %d  train %.6f  val %.6f", epoch, train_loss, val_loss)

        if val_loss < best_val:
            best_val, best_epoch = val_loss, epoch
            torch.save(model.state_dict(), out_dir / "model.pt")
            scaler.save(out_dir / "scaler.json")
            config.save(out_dir / "config.json")
        elif epoch - best_epoch >= config.early_stopping_patience:
            log.info("early stopping at epoch %d (best %.6f @ %d)",
                     epoch, best_val, best_epoch)
            break

    model.load_state_dict(torch.load(out_dir / "model.pt", weights_only=True))
    history["best_val_loss"] = best_val
    return model, history


@torch.no_grad()
def evaluate(model: TemporalFusionTransformer, loader: DataLoader,
             criterion: QuantileLoss) -> float:
    model.eval()
    total, count = 0.0, 0
    for batch in loader:
        out = model(batch["observed"], batch["known_enc"],
                    batch["known_dec"], batch["static"])
        loss = criterion(out["prediction"], batch["target"])
        total += loss.item() * len(batch["static"])
        count += len(batch["static"])
    return total / max(count, 1)


def load_artifacts(path: str | Path) -> tuple[TemporalFusionTransformer, FeatureScaler, TFTConfig]:
    path = Path(path)
    config = TFTConfig.load(path / "config.json")
    scaler = FeatureScaler.load(path / "scaler.json")
    model = TemporalFusionTransformer(config)
    model.load_state_dict(torch.load(path / "model.pt", weights_only=True))
    model.eval()
    return model, scaler, config
