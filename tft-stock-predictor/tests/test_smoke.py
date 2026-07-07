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
        ensemble_size=2,
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


def test_vlstm_variant(config):
    import dataclasses

    vcfg = dataclasses.replace(config, use_attention=False)
    model = TemporalFusionTransformer(vcfg)
    assert not hasattr(model, "attention")   # attention block not built
    model.eval()
    B, E, H = 2, vcfg.encoder_length, vcfg.horizon
    with torch.no_grad():
        out = model(
            torch.randn(B, E, len(OBSERVED_FEATURES)),
            torch.randn(B, E, len(KNOWN_FEATURES)),
            torch.randn(B, H, len(KNOWN_FEATURES)),
            torch.zeros(B, dtype=torch.long),
        )
    assert out["prediction"].shape == (B, H, vcfg.n_quantiles)
    # fewer parameters than the full TFT
    full = sum(p.numel() for p in TemporalFusionTransformer(config).parameters())
    slim = sum(p.numel() for p in model.parameters())
    assert slim < full


def test_multiticker_datasets(config):
    import dataclasses

    mcfg = dataclasses.replace(config, tickers=["SYN", "SYN2"])
    frames = {"SYN": build_features(synthetic_ohlcv(seed=0)),
              "SYN2": build_features(synthetic_ohlcv(seed=1))}
    train_ds, val_ds, _ = build_datasets(frames, mcfg)
    assert len(train_ds.datasets) == 2 and len(val_ds.datasets) == 2
    # static ids differ per ticker
    assert train_ds.datasets[0][0]["static"].item() == 0
    assert train_ds.datasets[1][0]["static"].item() == 1


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
    assert (tmp_path / "SYN_1h" / "model_1.pt").exists()   # 2nd ensemble member
    assert (tmp_path / "SYN_1h" / "history.json").exists()
    assert config.conformal and config.conformal["pooled"]["pairs"]  # CQR fitted
    assert "0" in config.conformal["per_ticker"]  # per-ticker offsets too

    from tft_predictor.model import EnsembleTFT
    from tft_predictor.training import load_artifacts
    model, scaler, cfg = load_artifacts(tmp_path / "SYN_1h")
    assert isinstance(model, EnsembleTFT) and len(model.members) == 2
    result = predict_from_frame(model, scaler, cfg, frames["SYN"])
    assert result["price"].shape == (cfg.horizon, cfg.n_quantiles)
    # non-crossing quantiles
    assert (np.diff(result["price"], axis=-1) >= 0).all()
    assert result["signal"]["action"] in {"LONG", "SHORT", "FLAT"}
    # variable-selection weights cover all inputs and form a distribution
    imp = result["variable_importance"]
    assert set(imp) == set(OBSERVED_FEATURES + KNOWN_FEATURES)
    assert sum(imp.values()) == pytest.approx(1.0, abs=1e-2)

    bt = backtest(model, scaler, cfg, frames["SYN"])
    assert bt["windows"] > 0
    assert 0.0 <= bt["interval_coverage"] <= 1.0


def test_conformal_restores_coverage():
    from tft_predictor.conformal import apply_conformal, conformal_offsets

    rng = np.random.default_rng(0)
    N, H = 400, 4
    true = rng.standard_normal((N, H))
    # deliberately too-narrow bands: nominal 80% but ±0.5σ covers only ~38%
    pred = np.stack([np.full((N, H), -0.5), np.zeros((N, H)),
                     np.full((N, H), 0.5)], axis=-1)
    quantiles = [0.1, 0.5, 0.9]
    conf = conformal_offsets(pred, true, quantiles)
    assert conf["pairs"] == [[0, 2]]
    adjusted = apply_conformal(pred, conf)
    covered = ((true >= adjusted[:, :, 0]) & (true <= adjusted[:, :, 2])).mean()
    assert covered >= 0.78  # CQR guarantee: >= 1 - alpha (up to finite-sample)
    # bands must widen and stay monotone
    assert (adjusted[:, :, 0] < pred[:, :, 0]).all()
    assert (np.diff(adjusted, axis=-1) >= 0).all()


def test_robust_scaler_ignores_outliers():
    from tft_predictor.data import FeatureScaler

    df = pd.DataFrame({"x": [0.0] * 50 + [1.0] * 50 + [1e6]})
    robust = FeatureScaler().fit(df, ["x"], robust=True)
    classic = FeatureScaler().fit(df, ["x"], robust=False)
    assert robust.std["x"] < 2.0            # IQR-based, unmoved by the spike
    assert classic.std["x"] > 1000.0        # std blows up


def test_embargo_gap_between_train_and_val(config):
    from tft_predictor.data import build_datasets

    frames = {"SYN": build_features(synthetic_ohlcv())}
    df = frames["SYN"]
    cut = int(len(df) * (1 - config.val_fraction))
    train_ds, val_ds, _ = build_datasets(frames, config)
    tr, va = train_ds.datasets[0], val_ds.datasets[0]
    last_train_target_end = tr.index[tr.origins[-1] + config.horizon]
    first_val_origin = va.index[va.origins[0]]
    gap_bars = int((first_val_origin - last_train_target_end)
                   / pd.Timedelta("1h"))
    assert gap_bars >= config.horizon - 1   # embargoed, no adjacent labels


def test_report_generation(config, tmp_path):
    from tft_predictor.report import build_report, write_report

    bt = {"objective": "quantile", "windows": 100,
          "interval_coverage": 0.79, "nominal_coverage": 0.8,
          "coverage_by_step": [0.8, 0.79, 0.81], "inner_coverage": 0.5,
          "inner_nominal": 0.5, "directional_accuracy": 0.51,
          "fee_bps_per_side": 5.0, "edge_threshold": 0.001, "trades": 4,
          "total_return": 0.012, "hit_rate": 0.5, "avg_return_per_trade": 0.003,
          "annualized_sharpe": 1.1, "annualized_sortino": None,
          "max_drawdown": -0.01}
    ev = {"summary": {"n_forecasts": 5, "n_matured": 3, "band_coverage": 0.67,
                      "nominal_coverage": 0.8, "sized_total_return": 0.01,
                      "max_drawdown": -0.002},
          "rows": [{"horizon_end": f"2026-01-0{i}", "sized_return": 0.003}
                   for i in range(1, 4)]}
    html_text = build_report(config, bt, eval_results=ev)
    for needle in ("tear-sheet", "Band coverage", "coverage by horizon",
                   "Live forecasts scored", "not\ninvestment advice"):
        assert needle in html_text, needle
    out = write_report(tmp_path, config, bt, eval_results=ev)
    assert out.exists() and out.name == "report.html"
    # sharpe-mode report renders the position tiles instead
    sbt = {"objective": "sharpe", "windows": 10, "fee_bps_per_side": 5.0,
           "total_return": 0.01, "annualized_sharpe": 0.3,
           "max_drawdown": -0.05, "avg_abs_position": 0.5,
           "turnover_per_bar": 0.05, "hit_rate": 0.51}
    assert "Turnover" in build_report(config, sbt)


def test_greedy_soup(config, tmp_path):
    import dataclasses

    from tft_predictor.data import build_datasets
    from tft_predictor.model import EnsembleTFT
    from tft_predictor.training import greedy_soup, train
    from torch.utils.data import DataLoader

    frames = {"SYN": build_features(synthetic_ohlcv())}
    gcfg = dataclasses.replace(config, ensemble_size=2, max_epochs=1,
                               conformal=None, greedy_soup=True)
    model, history = train(gcfg, frames=frames, artifacts=tmp_path)
    assert history["soup"] is not None
    assert history["soup"]["ingredients"] >= 1
    if history["soup"]["deployed"]:
        # soup deployed as a single model, no stale member files
        assert not isinstance(model, EnsembleTFT)
        assert not (tmp_path / "SYN_1h" / "model_1.pt").exists()
        assert history["soup"]["soup_val"] <= history["soup"]["ensemble_val"]
    else:
        assert isinstance(model, EnsembleTFT)

    # mechanics: soup of two identical members == the member itself
    _, val_ds, _ = build_datasets(frames, gcfg)
    loader = DataLoader(val_ds, batch_size=64)
    from tft_predictor.model import TemporalFusionTransformer
    m = TemporalFusionTransformer(gcfg)
    hists = [{"best_val_loss": 1.0}, {"best_val_loss": 2.0}]
    sd, val, n = greedy_soup([m, m], hists, loader, gcfg)
    assert n == 2  # identical weights: averaging can never hurt
    for k, v in m.state_dict().items():
        assert torch.allclose(sd[k], v)


def test_coverage_by_step_shapes(config, tmp_path):
    import dataclasses

    from tft_predictor.backtest import backtest
    from tft_predictor.training import train

    frames = {"SYN": build_features(synthetic_ohlcv())}
    ccfg = dataclasses.replace(config, ensemble_size=1, max_epochs=1,
                               conformal=None)
    model, _ = train(ccfg, frames=frames, artifacts=tmp_path)
    from tft_predictor.training import load_artifacts
    model, scaler, cfg = load_artifacts(tmp_path / "SYN_1h")
    results = backtest(model, scaler, cfg, frames["SYN"])
    assert len(results["coverage_by_step"]) == cfg.horizon
    assert all(0.0 <= c <= 1.0 for c in results["coverage_by_step"])


def test_walkforward(config):
    import dataclasses

    from tft_predictor.walkforward import walkforward

    wcfg = dataclasses.replace(config, ensemble_size=1, max_epochs=1,
                               conformal=None)
    features = build_features(synthetic_ohlcv())
    results = walkforward(wcfg, features, n_folds=2, min_train_fraction=0.5)
    assert results["n_folds"] == 2
    assert results["windows"] > 0
    assert 0.0 <= results["coverage"] <= 1.0
    assert len(results["folds"]) == 2
    # each fold's test starts strictly after the previous
    assert results["folds"][1]["test_start"] > results["folds"][0]["test_start"]
    # sharpe configs are rejected
    with pytest.raises(ValueError, match="quantile"):
        walkforward(dataclasses.replace(wcfg, objective="sharpe"), features)


def test_auto_retrain_gate_and_hot_swap(config, tmp_path):
    import dataclasses

    from tft_predictor.realtime import RealtimePredictor
    from tft_predictor.training import load_artifacts, train

    rcfg = dataclasses.replace(config, ensemble_size=1, max_epochs=1,
                               conformal=None)
    ohlcv = synthetic_ohlcv()
    frames = {"SYN": build_features(ohlcv)}
    train(rcfg, frames=frames, artifacts=tmp_path)
    art = tmp_path / "SYN_1h"
    model, scaler, cfg = load_artifacts(art)

    eng = RealtimePredictor(model, scaler, cfg, out_dir=art, auto_retrain=True)
    eng.history = ohlcv
    old_model = eng.model
    old_mtime = (art / "model.pt").stat().st_mtime
    eng._retrain_now("test")

    assert eng.last_retrain is not None
    assert eng.last_retrain["reason"] == "test"
    assert eng._retraining is False and eng._retrain_cooldown > 0
    if eng.last_retrain["accepted"]:
        assert eng.model is not old_model              # hot-swapped
        assert (art / "model.pt").stat().st_mtime > old_mtime
        assert eng._bars_since_train == 0
    else:  # gate may reject on a 1-epoch candidate — still a valid outcome
        assert eng.model is old_model


def test_drift_detection():
    from tft_predictor.drift import drift_report, fit_reference, psi

    rng = np.random.default_rng(0)
    train_df = pd.DataFrame({"a": rng.standard_normal(2000),
                             "b": rng.standard_normal(2000)})
    ref = fit_reference(train_df, ["a", "b"])
    # same distribution → tiny PSI, no retrain flag
    same = pd.DataFrame({"a": rng.standard_normal(300),
                         "b": rng.standard_normal(300)})
    rep = drift_report(same, ref)
    assert rep["max_psi"] < 0.1 and not rep["retrain_recommended"]
    # shifted feature → major PSI, retrain flag names the culprit
    shifted = pd.DataFrame({"a": rng.standard_normal(300) + 3.0,
                            "b": rng.standard_normal(300)})
    rep = drift_report(shifted, ref)
    assert rep["per_feature"]["a"] > 0.25
    assert rep["retrain_recommended"] and rep["drifted"] == ["a"]
    # psi is symmetric-ish sanity: zero-length series is safe
    assert psi(pd.Series([], dtype=float), ref["a"]) == 0.0


def test_trade_stats_and_threshold_tuning(config):
    import dataclasses

    from tft_predictor.backtest import simulate_trades, trade_stats, tune_edge_threshold

    # trade_stats math
    pnl = np.array([0.01, -0.005, 0.02, -0.01])
    stats = trade_stats(pnl, trades_per_year=100)
    assert stats["annualized_sharpe"] > 0
    assert stats["max_drawdown"] == pytest.approx(-0.01)
    assert trade_stats(np.array([]), 100)["annualized_sharpe"] is None

    # simulate_trades honors the threshold: strong signal trades, huge
    # threshold doesn't
    cfg = dataclasses.replace(config, horizon=2, quantiles=[0.1, 0.5, 0.9])
    pred = np.tile(np.array([[0.004, 0.006, 0.008],
                             [0.005, 0.007, 0.009]]), (6, 1, 1))
    true = np.full((6, 2), 0.01)
    assert len(simulate_trades(pred, true, cfg, 0.001, fee=0.0)) > 0
    assert len(simulate_trades(pred, true, cfg, 0.05, fee=0.0)) == 0


def test_sharpe_objective_end_to_end(config, tmp_path):
    import dataclasses

    from tft_predictor.backtest import backtest
    from tft_predictor.model.loss import SharpeLoss
    from tft_predictor.training import train

    # loss: perfect positions (sign of return) beat inverted positions
    loss_fn = SharpeLoss()
    rng = np.random.default_rng(0)
    steps = rng.standard_normal((64, 6)).astype(np.float32)
    cum = torch.tensor(np.cumsum(steps, axis=1))
    good = torch.tensor(np.sign(steps))
    assert loss_fn(good, cum) < loss_fn(-good, cum)

    scfg = dataclasses.replace(config, objective="sharpe", ensemble_size=1,
                               max_epochs=2, conformal=None)
    frames = {"SYN": build_features(synthetic_ohlcv())}
    model, history = train(scfg, frames=frames, artifacts=tmp_path)
    assert scfg.conformal is None            # no bands to calibrate
    B, E, H = 2, scfg.encoder_length, scfg.horizon
    with torch.no_grad():
        out = model(torch.randn(B, E, len(OBSERVED_FEATURES)),
                    torch.randn(B, E, len(KNOWN_FEATURES)),
                    torch.randn(B, H, len(KNOWN_FEATURES)),
                    torch.zeros(B, dtype=torch.long))
    pos = out["prediction"]
    assert pos.shape == (B, H, 1)
    assert (pos.abs() <= 1).all()            # tanh-bounded positions

    from tft_predictor.training import load_artifacts
    model, scaler, cfg = load_artifacts(tmp_path / "SYN_1h")
    results = backtest(model, scaler, cfg, frames["SYN"])
    assert results["objective"] == "sharpe"
    assert set(results) >= {"annualized_sharpe", "turnover_per_bar",
                            "max_drawdown", "avg_abs_position"}
    # quantile prediction path must refuse a position-head model
    with pytest.raises(ValueError, match="quantile"):
        predict_from_frame(model, scaler, cfg, frames["SYN"])


def test_adaptive_conformal_state():
    from tft_predictor.conformal import ACIState, apply_aci

    aci = ACIState()
    alpha, gamma = 0.2, 0.1
    # sustained misses widen: each miss adds gamma*(1-alpha)
    for _ in range(5):
        aci.update(in_band=False, alpha=alpha, gamma=gamma)
    assert aci.expand == pytest.approx(5 * gamma * (1 - alpha))
    widened = aci.expand
    # hits slowly narrow: each hit subtracts gamma*alpha
    for _ in range(3):
        aci.update(in_band=True, alpha=alpha, gamma=gamma)
    assert aci.expand == pytest.approx(widened - 3 * gamma * alpha)
    assert aci.n_updates == 8
    # long runs stay clipped
    for _ in range(200):
        aci.update(in_band=False, alpha=alpha, gamma=gamma)
    assert aci.expand == ACIState.MAX_EXPAND
    # round trip through persistence
    clone = ACIState.from_dict(aci.as_dict())
    assert clone.expand == aci.expand and clone.n_updates == aci.n_updates

    # applying expansion widens only the outer band, keeps monotonicity
    pred = np.array([[[-1.0, 0.0, 1.0]]])
    out = apply_aci(pred, 0.5)
    assert out[0, 0, 0] == pytest.approx(-1.5)
    assert out[0, 0, 2] == pytest.approx(1.5)
    assert out[0, 0, 1] == pytest.approx(0.0)
    assert (apply_aci(pred, 0.0) == pred).all()


def test_prob_up_from_quantile_cdf():
    q = [0.1, 0.5, 0.9]
    up = np.array([[0.001, 0.005, 0.009]])       # all quantiles above zero
    assert trading_signal(up, q)["prob_up"] == pytest.approx(0.9)
    down = np.array([[-0.009, -0.005, -0.001]])
    assert trading_signal(down, q)["prob_up"] == pytest.approx(0.1)
    mid = np.array([[-0.005, 0.0, 0.005]])       # median exactly at zero
    assert trading_signal(mid, q)["prob_up"] == pytest.approx(0.5)


def test_fees_reduce_pnl():
    from tft_predictor.evaluation import evaluate_records

    idx = pd.date_range("2026-01-01", periods=30, freq="1h", tz="UTC")
    closes = pd.Series([100.0 + i for i in range(30)], index=idx)
    rec = {
        "generated_at": idx[8].isoformat(),
        "horizon_timestamps": [idx[20].isoformat()],
        "last_close": 100.0,
        "quantiles": [0.1, 0.5, 0.9],
        "price_quantiles": [[105.0, 115.0, 125.0]],
        "signal": {"action": "LONG", "size_vol_target": 1.0},
    }
    free = evaluate_records([rec], closes, pd.Timedelta("30min"))["summary"]
    costly = evaluate_records([rec], closes, pd.Timedelta("30min"),
                              fee_bps=50)["summary"]
    # 50 bps per side → 100 bps round trip off the 20% move
    assert costly["trade_total_return"] == pytest.approx(
        free["trade_total_return"] - 0.01)
    assert costly["sized_total_return"] < free["sized_total_return"]


def test_ensemble_top_k_selection(config, tmp_path):
    import dataclasses

    kcfg = dataclasses.replace(config, ensemble_size=3, ensemble_keep=2,
                               max_epochs=1)
    frames = {"SYN": build_features(synthetic_ohlcv())}
    from tft_predictor.model import EnsembleTFT
    from tft_predictor.training import train

    model, history = train(kcfg, frames=frames, artifacts=tmp_path)
    assert isinstance(model, EnsembleTFT) and len(model.members) == 2
    assert len(history["members"]) == 2
    # only the kept members are on disk
    assert (tmp_path / "SYN_1h" / "model_1.pt").exists()
    assert not (tmp_path / "SYN_1h" / "model_2.pt").exists()


def test_kelly_and_vol_target_sizing():
    q = [0.1, 0.5, 0.9]
    strong = np.array([[0.004, 0.008, 0.012]])   # tight band, clear edge
    sig = trading_signal(strong, q)
    assert sig["action"] == "LONG"
    assert 0 < sig["size"] <= 1.0
    assert 0 < sig["size_vol_target"] <= 1.0
    flat = np.array([[-0.004, 0.0, 0.004]])
    fsig = trading_signal(flat, q)
    assert fsig["size"] == 0.0 and fsig["size_vol_target"] == 0.0
    # wider band → smaller vol-target size
    wide = np.array([[-0.02, 0.008, 0.036]])
    assert (trading_signal(wide, q)["size_vol_target"]
            < sig["size_vol_target"])


def test_evaluation_scores_matured_forecasts():
    from tft_predictor.evaluation import evaluate_records

    idx = pd.date_range("2026-01-01", periods=30, freq="1h", tz="UTC")
    closes = pd.Series([100.0 + i for i in range(30)], index=idx)
    matured = {
        "generated_at": idx[8].isoformat(),
        "horizon_timestamps": [idx[20].isoformat()],   # realized close = 120
        "last_close": 100.0,
        "quantiles": [0.1, 0.5, 0.9],
        "price_quantiles": [[105.0, 115.0, 125.0]],
        "signal": {"action": "LONG", "size_vol_target": 0.5},
    }
    pending = {**matured,
               "horizon_timestamps": [(idx[-1] + pd.Timedelta("10h")).isoformat()]}
    res = evaluate_records([matured, pending], closes, pd.Timedelta("30min"))
    s = res["summary"]
    assert s["n_forecasts"] == 2 and s["n_matured"] == 1
    assert s["band_coverage"] == 1.0            # 120 within [105, 125]
    assert s["directional_accuracy"] == 1.0     # predicted up, went up
    assert s["trades"] == 1
    assert s["trade_total_return"] == pytest.approx(0.20)
    assert s["median_abs_pct_error"] == pytest.approx(5 / 120)
    # sized paper P&L: 0.5 size on a +20% move, no drawdown
    assert s["sized_total_return"] == pytest.approx(0.10)
    assert s["max_drawdown"] == pytest.approx(0.0)


def test_dashboard_serves_state_and_page():
    import json as jsonlib
    import urllib.request

    from tft_predictor.dashboard import DashboardServer

    class FakeEngine:
        def __init__(self, ticker):
            self.ticker = ticker

        def snapshot(self):
            return {"status": "warming_up", "ticker": self.ticker}

    engines = {"SYN": FakeEngine("SYN"), "SYN2": FakeEngine("SYN2")}
    srv = DashboardServer(engines, port=0)  # ephemeral port
    srv.start()
    try:
        port = srv.port
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state") as r:
            state = jsonlib.loads(r.read())
        assert state["status"] == "warming_up" and state["ticker"] == "SYN"
        assert state["tickers"] == ["SYN", "SYN2"]
        with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/api/state?ticker=SYN2") as r:
            assert jsonlib.loads(r.read())["ticker"] == "SYN2"
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/") as r:
            html = r.read().decode()
        assert "TFT Live Forecast" in html and "drawChart" in html
    finally:
        srv.stop()


def test_run_many_round_robin():
    from tft_predictor.realtime import run_many

    calls = []

    class FakeEngine:
        def __init__(self, ticker):
            self.ticker = ticker

        def warm_start(self):
            calls.append(("warm", self.ticker))

        def poll(self):
            calls.append(("poll", self.ticker))
            return {"ok": self.ticker}

    engines = [FakeEngine("A"), FakeEngine("B"), FakeEngine("C")]
    run_many(engines, refresh_seconds=0, max_updates=3)
    assert [c for c in calls if c[0] == "warm"] == [
        ("warm", "A"), ("warm", "B"), ("warm", "C")]
    assert [c[1] for c in calls if c[0] == "poll"] == ["A", "B", "C"]


def test_coinbase_cache_spans(tmp_path):
    from datetime import datetime, timedelta, timezone

    from tft_predictor.data.coinbase import CoinbaseClient

    client = CoinbaseClient(cache_dir=tmp_path)
    end = datetime(2026, 7, 1, tzinfo=timezone.utc)
    start = end - timedelta(days=10)
    # no cache → one span covering everything
    assert client._missing_spans(None, start, end, 3600) == [(start, end)]
    # cache covering the middle → older gap + fresh tail
    idx = pd.date_range(start + timedelta(days=2), end - timedelta(days=2),
                        freq="1h", tz="UTC")
    cached = pd.DataFrame({"open": 1.0, "high": 1.0, "low": 1.0,
                           "close": 1.0, "volume": 0.0}, index=idx)
    spans = client._missing_spans(cached, start, end, 3600)
    assert len(spans) == 2
    assert spans[0][0] == start                      # older gap
    assert spans[1][1] == end                        # fresh tail
    # cache round trip preserves the index and values
    client._save_cache("TEST-USD", "1h", cached)
    loaded = client._load_cache("TEST-USD", "1h")
    assert len(loaded) == len(cached)
    assert (loaded.index == cached.index).all()


def test_dashboard_basic_auth():
    import base64
    import urllib.error
    import urllib.request

    from tft_predictor.dashboard import DashboardServer

    class FakeEngine:
        ticker = "SYN"

        def snapshot(self):
            return {"status": "warming_up"}

    srv = DashboardServer({"SYN": FakeEngine()}, port=0, host="0.0.0.0",
                          auth="trader:s3cret")
    srv.start()
    try:
        url = f"http://127.0.0.1:{srv.port}/api/state"
        try:
            urllib.request.urlopen(url)
            raise AssertionError("expected 401 without credentials")
        except urllib.error.HTTPError as err:
            assert err.code == 401
            assert "Basic" in err.headers.get("WWW-Authenticate", "")
        req = urllib.request.Request(url, headers={
            "Authorization": "Basic "
                             + base64.b64encode(b"trader:s3cret").decode()})
        with urllib.request.urlopen(req) as r:
            assert r.status == 200
        # bound to all interfaces → urls() lists at least localhost
        assert any("127.0.0.1" in u for u in srv.urls())
    finally:
        srv.stop()


def test_trading_signal_directions():
    q = [0.1, 0.5, 0.9]
    up = np.array([[0.001, 0.004, 0.006]])
    down = -up[:, ::-1]
    flat = np.array([[-0.004, 0.0, 0.004]])
    assert trading_signal(up, q)["action"] == "LONG"
    assert trading_signal(down, q)["action"] == "SHORT"
    assert trading_signal(flat, q)["action"] == "FLAT"
