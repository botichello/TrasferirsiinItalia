"""Feature engineering.

Two feature groups, matching the TFT input taxonomy:

- *observed* (past-only) features: returns, technical indicators, volume —
  known only up to the forecast origin.
- *known* (future-available) features: calendar encodings — deterministic
  functions of the timestamp, so they exist for future decoder steps too.

The prediction target is the cumulative log return from the forecast origin,
so quantile outputs translate directly into price bands:
    price_t = price_origin * exp(y_t).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

OBSERVED_FEATURES = [
    "log_return",
    "hl_range",
    "close_pos",
    "rsi_14",
    "macd",
    "macd_signal",
    "bb_pct",
    "atr_norm",
    "vol_20",
    "volume_z",
    "mom_10",
]
KNOWN_FEATURES = [
    "sin_tod",
    "cos_tod",
    "sin_dow",
    "cos_dow",
    "step_frac",
]


def _rsi(close: pd.Series, window: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / window, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / window, adjust=False).mean()
    rs = gain / loss.replace(0.0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50.0)


def build_features(ohlcv: pd.DataFrame) -> pd.DataFrame:
    """Compute observed + known features and the target column.

    Returns a frame with OBSERVED_FEATURES, KNOWN_FEATURES, `close`, and
    `target` (log return over the next bar; the dataset cumsums it across
    the horizon). Rows in the indicator warm-up window are dropped; the last
    row keeps a NaN target (usable for inference, excluded from training
    windows).
    """
    df = ohlcv.copy()
    close, high, low, volume = df["close"], df["high"], df["low"], df["volume"]

    df["log_return"] = np.log(close / close.shift(1))
    df["hl_range"] = (high - low) / close
    df["close_pos"] = ((close - low) / (high - low).replace(0.0, np.nan)).fillna(0.5)
    df["rsi_14"] = _rsi(close) / 100.0

    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    df["macd"] = (ema12 - ema26) / close
    df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()

    ma20 = close.rolling(20).mean()
    sd20 = close.rolling(20).std()
    df["bb_pct"] = ((close - ma20) / (2 * sd20.replace(0.0, np.nan))).clip(-3, 3)

    tr = pd.concat(
        [high - low, (high - close.shift(1)).abs(), (low - close.shift(1)).abs()],
        axis=1,
    ).max(axis=1)
    df["atr_norm"] = tr.ewm(alpha=1 / 14, adjust=False).mean() / close

    df["vol_20"] = df["log_return"].rolling(20).std()
    vol_ma = volume.rolling(20).mean()
    vol_sd = volume.rolling(20).std().replace(0.0, np.nan)
    df["volume_z"] = ((volume - vol_ma) / vol_sd).clip(-5, 5).fillna(0.0)
    df["mom_10"] = np.log(close / close.shift(10))

    df = df.join(calendar_features(df.index))

    # Per-bar future log return; WindowDataset cumsums it across the horizon.
    df["target"] = np.log(close.shift(-1) / close)

    keep = OBSERVED_FEATURES + KNOWN_FEATURES + ["close", "target"]
    df = df[keep]
    df = df.dropna(subset=OBSERVED_FEATURES + KNOWN_FEATURES)
    return df


def calendar_features(index: pd.DatetimeIndex) -> pd.DataFrame:
    """Deterministic time encodings — computable for future timestamps."""
    tod = (index.hour * 60 + index.minute) / (24 * 60)
    dow = index.dayofweek / 7.0
    doy = index.dayofyear / 366.0
    return pd.DataFrame(
        {
            "sin_tod": np.sin(2 * np.pi * tod),
            "cos_tod": np.cos(2 * np.pi * tod),
            "sin_dow": np.sin(2 * np.pi * dow),
            "cos_dow": np.cos(2 * np.pi * dow),
            "step_frac": doy,
        },
        index=index,
    )


def future_known_frame(last_ts: pd.Timestamp, interval: str, horizon: int) -> pd.DataFrame:
    """Known features for the next `horizon` bars after `last_ts`.

    Timestamps are extended by fixed interval deltas. For intraday intervals
    this ignores session boundaries — an accepted approximation, since the
    calendar features vary smoothly and the decoder mostly relies on the
    encoded history.
    """
    delta = interval_to_timedelta(interval)
    future_index = pd.DatetimeIndex([last_ts + delta * (i + 1) for i in range(horizon)])
    return calendar_features(future_index)


def interval_to_timedelta(interval: str) -> pd.Timedelta:
    table = {
        "1m": "1min", "2m": "2min", "5m": "5min", "15m": "15min",
        "30m": "30min", "1h": "1h", "1d": "1D", "1wk": "7D",
    }
    if interval not in table:
        raise ValueError(f"Unsupported interval: {interval}")
    return pd.Timedelta(table[interval])
