"""End-to-end smoke tests on synthetic data (no network required)."""

import numpy as np
import pandas as pd
import pytest
import torch

from tft_predictor.backtest import backtest
from tft_predictor.config import TFTConfig
from tft_predictor.data import build_datasets
from tft_predictor.data.features import (
    KNOWN_FEATURES,
    OBSERVED_FEATURES,
    build_features,
    future_known_frame,
)
from tft_predictor.model import QuantileLoss, TemporalFusionTransformer
from tft_predictor.predict import predict_from_frame, trading_signal
from tft_predictor.training import train


def synthetic_ohlcv(n: int = 800, seed: int = 0) -> pd.DataFrame:
    """Geometric random walk with a sine seasonality, hourly bars."""
    rng = np.random.default_rng(seed)
    t = np.arange(n)
    drift = 0.0002 * np.sin(2 * np.pi * t / 50)
    log_price = np.cumsum(drift + 0.005 * rng.standard_normal(n)) + np.log(100)
    close = np.exp(log_price)
    high = close * (1 + np.abs(rng.standard_normal(n)) * 0.003)
    low = close * (1 - np.abs(rng.standard_normal(n)) * 0.003)
    open_ = np.roll(close, 1)
    open_[0] = close[0]
    volume = rng.integers(1_000, 100_000, n).astype(float)
    index = pd.date_range("2024-01-02 09:30", periods=n, freq="1h", tz="America/New_York")
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=index)


@pytest.fixture(scope="module")
def config() -> TFTConfig:
    return TFTConfig(
        tickers=["SYN"], interval="1h", encoder_length=48, horizon=6,
        hidden_size=16, attention_heads=2, batch_size=32, max_epochs=2,
        observed_features=list(OBSERVED_FEATURES),
        known_features=list(KNOWN_FEATURES),
    )


def test_features_shapes_and_target():
    df = build_features(synthetic_ohlcv())
    assert set(OBSERVED_FEATURES + KNOWN_FEATURES + ["close", "target"]) <= set(df.columns)
    assert not df[OBSERVED_FEATURES].isna().any().any()
    # target is next-bar log return
    i = 10
    expected = np.log(df["close"].iloc[i + 1] / df["close"].iloc[i])
    assert df["target"].iloc[i] == pytest.approx(expected)


def test_future_known_frame():
    frame = future_known_frame(pd.Timestamp("2024-06-03 15:00", tz="UTC"), "1h", 6)
    assert len(frame) == 6
    assert list(frame.columns) == KNOWN_FEATURES
    assert frame.index[0] == pd.Timestamp("2024-06-03 16:00", tz="UTC")


def test_dataset_windows(config):
    frames = {"SYN": build_features(synthetic_ohlcv())}
    train_ds, val_ds, scaler = build_datasets(frames, config)
    assert len(train_ds) > 0 and len(val_ds) > 0
    item = train_ds[0]
    assert item["observed"].shape == (config.encoder_length, len(OBSERVED_FEATURES))
    assert item["known_dec"].shape == (config.horizon, len(KNOWN_FEATURES))
    assert item["target"].shape == (config.horizon,)
    assert not torch.isnan(item["target"]).any()


def test_model_forward(config):
    model = TemporalFusionTransformer(config)
    model.eval()  # dropout on attention weights would break the sum check
    B, E, H = 4, config.encoder_length, config.horizon
    with torch.no_grad():
        out = model(
            torch.randn(B, E, len(OBSERVED_FEATURES)),
            torch.randn(B, E, len(KNOWN_FEATURES)),
            torch.randn(B, H, len(KNOWN_FEATURES)),
            torch.zeros(B, dtype=torch.long),
        )
    assert out["prediction"].shape == (B, H, config.n_quantiles)
    assert out["attention"].shape == (B, H, E + H)
    # attention rows are proper distributions
    sums = out["attention"].sum(-1)
    assert torch.allclose(sums, torch.ones_like(sums), atol=1e-4)


def test_causal_masking(config):
    """Changing future decoder inputs must not affect earlier predictions...
    via attention. (LSTM decoder is causal by construction.)"""
    model = TemporalFusionTransformer(config)
    model.eval()
    B, E, H = 1, config.encoder_length, config.horizon
    obs = torch.randn(B, E, len(OBSERVED_FEATURES))
    ke = torch.randn(B, E, len(KNOWN_FEATURES))
    kd = torch.randn(B, H, len(KNOWN_FEATURES))
    static = torch.zeros(B, dtype=torch.long)
    with torch.no_grad():
        base = model(obs, ke, kd, static)["prediction"]
        kd2 = kd.clone()
        kd2[:, -1] += 100.0  # perturb only the last decoder step
        pert = model(obs, ke, kd2, static)["prediction"]
    assert torch.allclose(base[:, :-1], pert[:, :-1], atol=1e-5)


def test_quantile_loss_pinball():
    loss_fn = QuantileLoss([0.5])
    pred = torch.zeros(1, 1, 1)
    target = torch.full((1, 1), 2.0)
    # median pinball loss = 0.5 * |error|
    assert loss_fn(pred, target).item() == pytest.approx(1.0)


def test_train_and_predict_end_to_end(config, tmp_path):
    frames = {"SYN": build_features(synthetic_ohlcv())}
    model, history = train(config, frames=frames, artifacts=tmp_path)
    assert history["val_loss"][-1] < history["val_loss"][0] * 1.5  # sanity, not divergence
    assert (tmp_path / "SYN_1h" / "model.pt").exists()

    from tft_predictor.training import load_artifacts
    model, scaler, cfg = load_artifacts(tmp_path / "SYN_1h")
    result = predict_from_frame(model, scaler, cfg, frames["SYN"])
    assert result["price"].shape == (cfg.horizon, cfg.n_quantiles)
    # non-crossing quantiles
    assert (np.diff(result["price"], axis=-1) >= 0).all()
    assert result["signal"]["action"] in {"LONG", "SHORT", "FLAT"}

    bt = backtest(model, scaler, cfg, frames["SYN"])
    assert bt["windows"] > 0
    assert 0.0 <= bt["interval_coverage"] <= 1.0


def test_trading_signal_directions():
    q = [0.1, 0.5, 0.9]
    up = np.array([[0.001, 0.004, 0.006]])
    down = -up[:, ::-1]
    flat = np.array([[-0.004, 0.0, 0.004]])
    assert trading_signal(up, q)["action"] == "LONG"
    assert trading_signal(down, q)["action"] == "SHORT"
    assert trading_signal(flat, q)["action"] == "FLAT"
