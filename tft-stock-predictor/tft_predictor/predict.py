"""Single-shot inference: history frame → quantile price forecast."""

from __future__ import annotations

import numpy as np
import pandas as pd
import torch

import torch.nn as nn

from .config import TFTConfig
from .conformal import apply_conformal
from .data import FeatureScaler
from .data.features import KNOWN_FEATURES, OBSERVED_FEATURES, future_known_frame


@torch.no_grad()
def predict_from_frame(model: nn.Module, scaler: FeatureScaler,
                       config: TFTConfig, features: pd.DataFrame,
                       ticker_id: int = 0) -> dict:
    """Forecast from the last `encoder_length` rows of a feature frame.

    Returns quantile *price* paths (cumulative-return quantiles applied to the
    last close), future timestamps, and interpretability weights.
    """
    if len(features) < config.encoder_length:
        raise ValueError(
            f"need >= {config.encoder_length} feature rows, got {len(features)}")

    window = scaler.transform(features.iloc[-config.encoder_length:])
    last_ts = features.index[-1]
    last_close = float(features["close"].iloc[-1])
    future_known = future_known_frame(last_ts, config.interval, config.horizon)

    observed = torch.tensor(
        window[OBSERVED_FEATURES].to_numpy(dtype=np.float32)).unsqueeze(0)
    known_enc = torch.tensor(
        window[KNOWN_FEATURES].to_numpy(dtype=np.float32)).unsqueeze(0)
    known_dec = torch.tensor(
        future_known[KNOWN_FEATURES].to_numpy(dtype=np.float32)).unsqueeze(0)
    static = torch.tensor([ticker_id], dtype=torch.long)

    model.eval()
    out = model(observed, known_enc, known_dec, static)
    cum_log_ret = out["prediction"].squeeze(0).numpy()          # (H, Q)
    # De-normalize: the model was trained on vol-scaled returns so one set
    # of weights serves all regimes; scale back by the origin's volatility.
    if config.vol_normalize_target and "target_scale" in features.columns:
        cum_log_ret = cum_log_ret * float(features["target_scale"].iloc[-1])
    # Enforce non-crossing quantiles, then apply the CQR coverage correction.
    cum_log_ret = np.sort(cum_log_ret, axis=-1)
    if config.conformal:
        cum_log_ret = apply_conformal(cum_log_ret, config.conformal)
    prices = last_close * np.exp(cum_log_ret)

    # Mean selection weight per input variable over the encoder window —
    # "what the model looked at" for this forecast. Order matches the
    # encoder VSN input: observed features first, then known features.
    feature_names = list(config.observed_features) + list(config.known_features)
    importance = out["encoder_var_weights"].squeeze(0).mean(dim=0).numpy()

    return {
        "timestamps": list(future_known.index),
        "last_close": last_close,
        "last_bar_time": last_ts,
        "quantiles": config.quantiles,
        "cum_log_return": cum_log_ret,                          # (H, Q)
        "price": prices,                                        # (H, Q)
        "attention": out["attention"].squeeze(0).numpy(),
        "encoder_var_weights": out["encoder_var_weights"].squeeze(0).numpy(),
        "variable_importance": dict(zip(feature_names, importance.round(4).tolist())),
        "signal": trading_signal(cum_log_ret, config.quantiles),
    }


def trading_signal(cum_log_ret: np.ndarray, quantiles: list[float],
                   edge_threshold: float = 0.0005,
                   kelly_fraction: float = 0.25,
                   vol_target: float = 0.01) -> dict:
    """Turn horizon-end quantiles into a position signal with sizing.

    Direction: long when the median predicted move clears the threshold and
    the downside quantile doesn't overwhelm it; symmetric for shorts.

    Two research-backed sizes are reported (both capped at 1x capital):
    - `size` — fractional Kelly: the quantile spread implies a forecast
      standard deviation (an 80% interval spans ±1.2816σ under normality);
      the Kelly ratio μ/σ² is scaled by `kelly_fraction` (quarter-Kelly —
      full Kelly is famously too aggressive under estimation error).
    - `size_vol_target` — volatility targeting, the convention in the
      momentum-network literature (e.g. arXiv:2603.01820): position scaled
      so forecast risk equals `vol_target` per horizon (default 1%).
    """
    q = np.asarray(quantiles)
    lo_i, hi_i = int(q.argmin()), int(q.argmax())
    med_i = int(np.abs(q - 0.5).argmin())
    end = cum_log_ret[-1]
    median, lo, hi = float(end[med_i]), float(end[lo_i]), float(end[hi_i])
    spread = max(hi - lo, 1e-8)
    confidence = min(abs(median) / spread, 1.0)

    z_span = 2 * 1.2816 * (q[hi_i] - q[lo_i]) / 0.8  # σ multiple of the interval
    sigma = max(spread / z_span, 1e-6)
    size = min(abs(median) / sigma ** 2 * kelly_fraction, 1.0)
    size_vol_target = min(vol_target / sigma, 1.0)

    if median > edge_threshold and lo > -abs(median):
        action = "LONG"
    elif median < -edge_threshold and hi < abs(median):
        action = "SHORT"
    else:
        action = "FLAT"
    return {
        "action": action,
        "expected_return": median,
        "lower": lo,
        "upper": hi,
        "confidence": round(confidence, 4),
        "size": round(size if action != "FLAT" else 0.0, 4),
        "size_vol_target": round(size_vol_target if action != "FLAT" else 0.0, 4),
    }
