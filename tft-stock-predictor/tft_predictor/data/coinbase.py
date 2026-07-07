"""Coinbase Exchange public candles API client.

No authentication required. Crypto markets trade 24/7, which makes this
provider ideal for exercising the real-time loop outside equity market hours.
Symbols are Coinbase product ids, e.g. ``BTC-USD``, ``ETH-USD``.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests

log = logging.getLogger(__name__)


def _default_cache_dir() -> Path | None:
    """Bar cache location; set TFT_CACHE_DIR="" to disable caching."""
    raw = os.environ.get("TFT_CACHE_DIR")
    if raw == "":
        return None
    return Path(raw).expanduser() if raw else Path.home() / ".cache" / "tft-predictor"

_CANDLES_URL = "https://api.exchange.coinbase.com/products/{symbol}/candles"
_HEADERS = {"User-Agent": "tft-stock-predictor/0.1", "Accept": "application/json"}

_GRANULARITY = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "6h": 21600, "1d": 86400}
_MAX_CANDLES_PER_REQUEST = 300


class CoinbaseClient:
    def __init__(self, max_retries: int = 4, backoff: float = 2.0,
                 timeout: float = 30.0, cache_dir: Path | str | None = "auto"):
        self.session = requests.Session()
        self.session.headers.update(_HEADERS)
        self.max_retries = max_retries
        self.backoff = backoff
        self.timeout = timeout
        self.cache_dir = (_default_cache_dir() if cache_dir == "auto"
                          else Path(cache_dir) if cache_dir else None)

    def fetch(self, symbol: str, interval: str = "1h",
              range_: str | None = None, **_ignored) -> pd.DataFrame:
        """Fetch OHLCV bars covering `range_` (e.g. '365d'), paginating the
        300-candle-per-request API limit. Bars already on disk are not
        re-fetched: only the gap since the cache's newest bar (and any
        missing older span) hits the API."""
        if interval not in _GRANULARITY:
            raise ValueError(f"Coinbase supports intervals {list(_GRANULARITY)}, "
                             f"got {interval!r}")
        gran = _GRANULARITY[interval]
        days = _range_to_days(range_ or "90d", interval)
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=days)

        cached = self._load_cache(symbol, interval)
        spans = self._missing_spans(cached, start, end, gran)
        frames = [cached] if cached is not None else []
        for span_start, span_end in spans:
            frames.append(self._fetch_span(symbol, gran, span_start, span_end))
        df = pd.concat([f for f in frames if f is not None and not f.empty])
        df = df[~df.index.duplicated(keep="last")].sort_index()
        if df.empty:
            raise ValueError(f"No data returned for {symbol}")
        self._save_cache(symbol, interval, df)
        return df[df.index >= pd.Timestamp(start)]

    def _fetch_span(self, symbol: str, gran: int,
                    start: datetime, end: datetime) -> pd.DataFrame:
        frames = []
        window = timedelta(seconds=gran * _MAX_CANDLES_PER_REQUEST)
        cursor = start
        while cursor < end:
            chunk_end = min(cursor + window, end)
            rows = self._get(symbol, gran, cursor, chunk_end)
            if rows:
                frames.append(rows)
            cursor = chunk_end
            time.sleep(0.15)  # stay well inside public rate limits
        if not frames:
            return pd.DataFrame()
        return self._to_frame([r for chunk in frames for r in chunk])

    @staticmethod
    def _missing_spans(cached: pd.DataFrame | None, start: datetime,
                       end: datetime, gran: int) -> list[tuple[datetime, datetime]]:
        """Which time ranges the cache doesn't cover (older gap + fresh tail)."""
        if cached is None or cached.empty:
            return [(start, end)]
        spans = []
        first = cached.index[0].to_pydatetime()
        last = cached.index[-1].to_pydatetime()
        if start < first - timedelta(seconds=gran):
            spans.append((start, first))
        # refetch the last cached bar too — it may have been still forming
        spans.append((max(start, last - timedelta(seconds=gran)), end))
        return spans

    def _cache_path(self, symbol: str, interval: str) -> Path | None:
        if self.cache_dir is None:
            return None
        return self.cache_dir / f"{symbol}_{interval}.csv"

    def _load_cache(self, symbol: str, interval: str) -> pd.DataFrame | None:
        path = self._cache_path(symbol, interval)
        if path is None or not path.exists():
            return None
        try:
            df = pd.read_csv(path, index_col="timestamp", parse_dates=True)
            df.index = pd.to_datetime(df.index, utc=True)
            return df.astype(float)
        except Exception as err:  # noqa: BLE001 - a bad cache is not fatal
            log.warning("ignoring unreadable cache %s (%s)", path, err)
            return None

    def _save_cache(self, symbol: str, interval: str, df: pd.DataFrame) -> None:
        path = self._cache_path(symbol, interval)
        if path is None:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        out = df.tail(200_000).copy()
        out.index.name = "timestamp"
        out.to_csv(path)

    def latest(self, symbol: str, interval: str = "1m") -> pd.DataFrame:
        """Most recent candles — used by the realtime loop."""
        gran = _GRANULARITY[interval]
        end = datetime.now(timezone.utc)
        start = end - timedelta(seconds=gran * _MAX_CANDLES_PER_REQUEST)
        return self._to_frame(self._get(symbol, gran, start, end))

    # ------------------------------------------------------------------
    def _get(self, symbol: str, granularity: int,
             start: datetime, end: datetime) -> list:
        params = {
            "granularity": granularity,
            "start": start.isoformat(),
            "end": end.isoformat(),
        }
        url = _CANDLES_URL.format(symbol=symbol)
        last_err: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                resp = self.session.get(url, params=params, timeout=self.timeout)
                resp.raise_for_status()
                return resp.json()
            except Exception as err:  # noqa: BLE001 - retry any transport error
                last_err = err
                wait = self.backoff * (2 ** attempt)
                log.warning("Coinbase fetch failed (%s), retrying in %.0fs", err, wait)
                time.sleep(wait)
        raise ConnectionError(f"Coinbase request failed after retries: {last_err}")

    @staticmethod
    def _to_frame(rows: list) -> pd.DataFrame:
        # API rows: [time, low, high, open, close, volume], newest first.
        df = pd.DataFrame(rows, columns=["time", "low", "high", "open", "close", "volume"])
        df.index = pd.to_datetime(df.pop("time"), unit="s", utc=True)
        df.index.name = "timestamp"
        df = df[["open", "high", "low", "close", "volume"]].astype(float)
        df = df[~df.index.duplicated(keep="last")].sort_index()
        return df.dropna(subset=["close"])


def _range_to_days(range_: str, interval: str) -> float:
    if range_ == "max":
        # keep "max" bounded: ~5 years of dailies, less for finer bars
        return {"1d": 1825, "6h": 730, "1h": 365}.get(interval, 30)
    units = {"d": 1, "w": 7, "mo": 30, "y": 365}
    for suffix, mult in sorted(units.items(), key=lambda kv: -len(kv[0])):
        if range_.endswith(suffix):
            return float(range_[: -len(suffix)]) * mult
    raise ValueError(f"Cannot parse range {range_!r}")
