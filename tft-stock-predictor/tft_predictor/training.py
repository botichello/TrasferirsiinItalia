"""Training: warmup+cosine LR, EMA weight averaging, deep ensembles,
early stopping, and post-hoc conformal calibration.

Recipe (each piece is standard modern practice):
- linear LR warmup then cosine decay to zero over the full run;
- an exponential moving average of the weights is what gets validated and
  checkpointed — EMA weights generalize better than the raw trajectory;
- optionally an ensemble of members trained from different seeds, whose
  averaged quantiles carry model-disagreement uncertainty;
- after training, CQR offsets are fitted on the (embargoed) validation set
  and stored in the config so live bands carry a coverage guarantee.
"""

from __future__ import annotations

import copy
import json
import logging
import math
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from .config import TFTConfig, artifacts_dir
from .conformal import fit_conformal
from .data import FeatureScaler, build_datasets, get_client
from .data.features import KNOWN_FEATURES, OBSERVED_FEATURES, build_features
from .model import EnsembleTFT, QuantileLoss, TemporalFusionTransformer

log = logging.getLogger(__name__)


def fetch_training_frames(config: TFTConfig) -> dict:
    client = get_client(config.provider)
    frames = {}
    for ticker in config.tickers:
        ohlcv = client.fetch(ticker, interval=config.interval, range_=config.lookback)
        frames[ticker] = build_features(ohlcv)
        log.info("%s: %d bars → %d feature rows", ticker, len(ohlcv), len(frames[ticker]))
    return frames


class ModelEMA:
    """Exponential moving average of model weights."""

    def __init__(self, model: torch.nn.Module, decay: float):
        self.decay = decay
        self.shadow = {k: v.detach().clone()
                       for k, v in model.state_dict().items()}

    def update(self, model: torch.nn.Module) -> None:
        for k, v in model.state_dict().items():
            if v.dtype.is_floating_point:
                self.shadow[k].mul_(self.decay).add_(v.detach(),
                                                     alpha=1 - self.decay)
            else:
                self.shadow[k] = v.detach().clone()


def _warmup_cosine(optimizer, total_steps: int, warmup_fraction: float):
    warmup = max(1, int(total_steps * warmup_fraction))

    def schedule(step: int) -> float:
        if step < warmup:
            return (step + 1) / warmup
        progress = (step - warmup) / max(1, total_steps - warmup)
        return 0.5 * (1 + math.cos(math.pi * min(1.0, progress)))

    return torch.optim.lr_scheduler.LambdaLR(optimizer, schedule)


def _train_member(config: TFTConfig, train_loader: DataLoader,
                  val_loader: DataLoader, seed: int) -> tuple[dict, dict]:
    """Train one ensemble member; returns (best EMA state_dict, history)."""
    torch.manual_seed(seed)
    model = TemporalFusionTransformer(config)
    criterion = QuantileLoss(config.quantiles)
    optimizer = torch.optim.AdamW(model.parameters(), lr=config.learning_rate)
    total_steps = config.max_epochs * max(1, len(train_loader))
    scheduler = _warmup_cosine(optimizer, total_steps, config.warmup_fraction)
    ema = ModelEMA(model, config.ema_decay)

    best_val, best_epoch, best_state = float("inf"), -1, None
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
            scheduler.step()
            ema.update(model)
            total += loss.item() * len(batch["static"])
            count += len(batch["static"])
        train_loss = total / max(count, 1)

        # validate the EMA weights — that's what would ship
        raw_state = None if config.switch_ema else copy.deepcopy(model.state_dict())
        model.load_state_dict(ema.shadow)
        val_loss = evaluate(model, val_loader, criterion)
        if raw_state is not None:
            model.load_state_dict(raw_state)
        # with switch_ema the online model keeps training FROM the EMA
        # weights (SEMA, arXiv:2402.09240) — a "free lunch" over vanilla EMA

        history["train_loss"].append(train_loss)
        history["val_loss"].append(val_loss)
        log.info("seed %d epoch %d  train %.6f  val(EMA) %.6f",
                 seed, epoch, train_loss, val_loss)

        if val_loss < best_val:
            best_val, best_epoch = val_loss, epoch
            best_state = {k: v.clone() for k, v in ema.shadow.items()}
        elif epoch - best_epoch >= config.early_stopping_patience:
            log.info("early stopping at epoch %d (best %.6f @ %d)",
                     epoch, best_val, best_epoch)
            break

    history["best_val_loss"] = best_val
    return best_state, history


def train(config: TFTConfig, frames: dict | None = None,
          artifacts: str | Path = "artifacts"
          ) -> tuple[torch.nn.Module, dict]:
    config.observed_features = list(OBSERVED_FEATURES)
    config.known_features = list(KNOWN_FEATURES)

    if frames is None:
        frames = fetch_training_frames(config)
    train_ds, val_ds, scaler = build_datasets(frames, config)
    log.info("train windows: %d, val windows: %d", len(train_ds), len(val_ds))

    train_loader = DataLoader(train_ds, batch_size=config.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=config.batch_size)

    members, histories = [], []
    for i in range(max(1, config.ensemble_size)):
        state, hist = _train_member(config, train_loader, val_loader,
                                    seed=config.seed + i)
        member = TemporalFusionTransformer(config)
        member.load_state_dict(state)
        member.eval()
        members.append(member)
        histories.append(hist)

    # top-K-of-N selection by validation loss (the 2026 futures benchmark's
    # core robustness recipe: ensemble the best seeds, not all seeds)
    if config.ensemble_keep and config.ensemble_keep < len(members):
        ranked = sorted(range(len(members)),
                        key=lambda i: histories[i]["best_val_loss"])
        kept = sorted(ranked[:config.ensemble_keep])
        log.info("keeping top %d/%d members by val loss: %s",
                 config.ensemble_keep, len(members), kept)
        members = [members[i] for i in kept]
        histories = [histories[i] for i in kept]

    model: torch.nn.Module = (members[0] if len(members) == 1
                              else EnsembleTFT(members))
    model.eval()

    # conformal calibration on the embargoed validation set
    config.conformal = fit_conformal(model, val_loader, config.quantiles)
    criterion = QuantileLoss(config.quantiles)
    ensemble_val = evaluate(model, val_loader, criterion)

    out_dir = artifacts_dir(config, artifacts)
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, member in enumerate(members):
        torch.save(member.state_dict(),
                   out_dir / ("model.pt" if i == 0 else f"model_{i}.pt"))
    scaler.save(out_dir / "scaler.json")
    config.save(out_dir / "config.json")

    history = {
        "members": histories,
        "best_val_loss": min(h["best_val_loss"] for h in histories),
        "ensemble_val_loss": ensemble_val,
        "train_loss": histories[0]["train_loss"],
        "val_loss": histories[0]["val_loss"],
    }
    (out_dir / "history.json").write_text(json.dumps(history, indent=2))
    return model, history


@torch.no_grad()
def evaluate(model: torch.nn.Module, loader: DataLoader,
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


def load_artifacts(path: str | Path
                   ) -> tuple[torch.nn.Module, FeatureScaler, TFTConfig]:
    path = Path(path)
    config = TFTConfig.load(path / "config.json")
    scaler = FeatureScaler.load(path / "scaler.json")
    member_paths = [path / "model.pt"] + sorted(path.glob("model_[0-9]*.pt"))
    members = []
    for p in member_paths:
        member = TemporalFusionTransformer(config)
        member.load_state_dict(torch.load(p, weights_only=True))
        member.eval()
        members.append(member)
    model: torch.nn.Module = (members[0] if len(members) == 1
                              else EnsembleTFT(members))
    model.eval()
    return model, scaler, config
