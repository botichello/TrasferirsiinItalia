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

import pandas as pd
import torch
from torch.utils.data import DataLoader

from .config import TFTConfig, artifacts_dir
from .conformal import fit_conformal
from .data import FeatureScaler, build_datasets, get_client
from .data.features import KNOWN_FEATURES, OBSERVED_FEATURES, build_features
from .model import EnsembleTFT, QuantileLoss, TemporalFusionTransformer
from .model.loss import SharpeLoss

log = logging.getLogger(__name__)


def make_criterion(config: TFTConfig) -> torch.nn.Module:
    if config.objective == "sharpe":
        return SharpeLoss()
    return QuantileLoss(config.quantiles)


def compute_loss(criterion: torch.nn.Module, out: dict, batch: dict,
                 config: TFTConfig) -> torch.Tensor:
    if config.objective == "sharpe":
        return criterion(out["prediction"].squeeze(-1), batch["target"])
    return criterion(out["prediction"], batch["target"])


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
    criterion = make_criterion(config)
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
            loss = compute_loss(criterion, out, batch, config)
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


def greedy_soup(members: list[torch.nn.Module], histories: list[dict],
                val_loader: DataLoader, config: TFTConfig
                ) -> tuple[dict, float, int]:
    """Greedy model soup (Wortsman et al., 2022).

    Sort members by validation loss, then add each to a uniform weight
    average only if validation doesn't degrade — guaranteed no worse than
    the best single member on the held-out split. Returns (state_dict,
    val_loss, n_ingredients). A soup is one model: N× cheaper at inference
    than an output-averaged ensemble.
    """
    criterion = make_criterion(config)
    probe = TemporalFusionTransformer(config)

    def average(states: list[dict]) -> dict:
        out = {}
        for k, v in states[0].items():
            if v.dtype.is_floating_point:
                out[k] = torch.stack([s[k] for s in states]).mean(dim=0)
            else:
                out[k] = v.clone()
        return out

    def val_of(sd: dict) -> float:
        probe.load_state_dict(sd)
        probe.eval()
        return evaluate(probe, val_loader, criterion)

    order = sorted(range(len(members)),
                   key=lambda i: histories[i]["best_val_loss"])
    soup = [members[order[0]].state_dict()]
    best_val = val_of(average(soup))
    for idx in order[1:]:
        candidate = soup + [members[idx].state_dict()]
        v = val_of(average(candidate))
        if v <= best_val:
            soup, best_val = candidate, v
    return average(soup), best_val, len(soup)


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

    soup_note = None
    if len(members) > 1 and config.greedy_soup:
        criterion = make_criterion(config)
        ensemble_val_pre = evaluate(model, val_loader, criterion)
        soup_sd, soup_val, n_ing = greedy_soup(
            members, histories, val_loader, config)
        deployed = soup_val <= ensemble_val_pre
        soup_note = {"ingredients": n_ing, "soup_val": soup_val,
                     "ensemble_val": ensemble_val_pre, "deployed": deployed}
        log.info("greedy soup: %s", soup_note)
        if deployed:
            soup_model = TemporalFusionTransformer(config)
            soup_model.load_state_dict(soup_sd)
            soup_model.eval()
            members = [soup_model]
            model = soup_model

    if config.objective == "quantile":
        # conformal calibration on the embargoed validation set
        config.conformal = fit_conformal(model, val_loader, config.quantiles)
        # then tune the signal threshold on the same calibrated outputs
        from .backtest import tune_edge_threshold
        config.edge_threshold = tune_edge_threshold(model, val_loader, config)
    criterion = make_criterion(config)
    ensemble_val = evaluate(model, val_loader, criterion)

    out_dir = artifacts_dir(config, artifacts)
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("model_[0-9]*.pt"):
        stale.unlink()  # don't let members from a previous run linger
    for i, member in enumerate(members):
        torch.save(member.state_dict(),
                   out_dir / ("model.pt" if i == 0 else f"model_{i}.pt"))
    scaler.save(out_dir / "scaler.json")
    config.save(out_dir / "config.json")

    # drift reference: decile bins per feature on the raw training data
    from .drift import fit_reference, save_reference
    train_concat = pd.concat(
        [df.iloc[:int(len(df) * (1 - config.val_fraction))]
         for df in frames.values()])
    save_reference(fit_reference(train_concat, OBSERVED_FEATURES),
                   out_dir / "drift.json")

    history = {
        "members": histories,
        "best_val_loss": min(h["best_val_loss"] for h in histories),
        "ensemble_val_loss": ensemble_val,
        "soup": soup_note,
        "train_loss": histories[0]["train_loss"],
        "val_loss": histories[0]["val_loss"],
    }
    (out_dir / "history.json").write_text(json.dumps(history, indent=2))
    return model, history


@torch.no_grad()
def evaluate(model: torch.nn.Module, loader: DataLoader,
             criterion: torch.nn.Module) -> float:
    model.eval()
    total, count = 0.0, 0
    config = getattr(model, "config", None) or model.members[0].config
    for batch in loader:
        out = model(batch["observed"], batch["known_enc"],
                    batch["known_dec"], batch["static"])
        loss = compute_loss(criterion, out, batch, config)
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
