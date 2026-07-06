"""Single-shot inference: history frame → quantile price forecast."""

from __future__ import annotations

import numpy as np
import pandas as pd
import torch

from .config import TFTConfig
from .data import FeatureScaler
from .data.features import KNOWN_FEATURES, OBSERVED_FEATURES, future_known_frame
from .model import TemporalFusionTransformer


@torch.no_grad()
def predict_from_frame(model: TemporalFusionTransformer, scaler: FeatureScaler,
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
    # Enforce non-crossing quantiles at each step.
    cum_log_ret = np.sort(cum_log_ret, axis=-1)
    prices = last_close * np.exp(cum_log_ret)

    return {
        "timestamps": list(future_known.index),
        "last_close": last_close,
        "last_bar_time": last_ts,
        "quantiles": config.quantiles,
        "cum_log_return": cum_log_ret,                          # (H, Q)
        "price": prices,                                        # (H, Q)
        "attention": out["attention"].squeeze(0).numpy(),
        "encoder_var_weights": out["encoder_var_weights"].squeeze(0).numpy(),
        "signal": trading_signal(cum_log_ret, config.quantiles),
    }


def trading_signal(cum_log_ret: np.ndarray, quantiles: list[float],
                   edge_threshold: float = 0.0005) -> dict:
    """Turn horizon-end quantiles into a position signal.

    Long when the median predicted move clears the threshold and the risk-
    adjusted edge (median vs. inter-quantile spread) is positive; symmetric
    for shorts. Sized by |median| / spread, capped at 1.
    """
    q = np.asarray(quantiles)
    lo_i, hi_i = int(q.argmin()), int(q.argmax())
    med_i = int(np.abs(q - 0.5).argmin())
    end = cum_log_ret[-1]
    median, lo, hi = float(end[med_i]), float(end[lo_i]), float(end[hi_i])
    spread = max(hi - lo, 1e-8)
    confidence = min(abs(median) / spread, 1.0)

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
    }
