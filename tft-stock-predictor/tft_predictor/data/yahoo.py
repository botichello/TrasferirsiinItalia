"""Minimal Yahoo Finance chart-API client.

Uses plain `requests` (works behind TLS-re-terminating proxies where
curl-impersonation backends fail) with retry/backoff and session cookies.
Returns tidy OHLCV DataFrames indexed by timezone-aware timestamps.
"""

from __future__ import annotations

import logging
import time

import pandas as pd
import requests

log = logging.getLogger(__name__)

_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

# Yahoo caps how far back each intraday interval reaches.
_MAX_RANGE = {
    "1m": "7d",
    "2m": "60d",
    "5m": "60d",
    "15m": "60d",
    "30m": "60d",
    "1h": "730d",
    "1d": "max",
    "1wk": "max",
}


class YahooFinanceClient:
    def __init__(self, max_retries: int = 4, backoff: float = 2.0, timeout: float = 30.0):
        self.session = requests.Session()
        self.session.headers.update(_HEADERS)
        self.max_retries = max_retries
        self.backoff = backoff
        self.timeout = timeout

    def fetch(self, symbol: str, interval: str = "1h", range_: str | None = None,
              include_prepost: bool = False) -> pd.DataFrame:
        """Fetch OHLCV bars. `range_` like '7d', '60d', '730d', 'max'."""
        if range_ is None:
            range_ = _MAX_RANGE.get(interval, "60d")
        params = {
            "interval": interval,
            "range": range_,
            "includePrePost": str(include_prepost).lower(),
            "events": "div,splits",
        }
        payload = self._get(_CHART_URL.format(symbol=symbol), params)
        return self._parse_chart(payload, symbol)

    def latest(self, symbol: str, interval: str = "1m") -> pd.DataFrame:
        """Most recent session of bars — used by the realtime loop."""
        range_ = "1d" if interval.endswith("m") else "5d"
        return self.fetch(symbol, interval=interval, range_=range_, include_prepost=False)

    # ------------------------------------------------------------------
    def _prime_cookies(self) -> None:
        """Yahoo rate-limits anonymous clients aggressively; a cookie from
        fc.yahoo.com (served on an error page, hence the bare try) helps."""
        try:
            self.session.get("https://fc.yahoo.com", timeout=10)
        except requests.RequestException:
            pass

    def _get(self, url: str, params: dict) -> dict:
        last_err: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                resp = self.session.get(url, params=params, timeout=self.timeout)
                if resp.status_code == 429:
                    self._prime_cookies()
                    raise requests.HTTPError("429 rate limited", response=resp)
                resp.raise_for_status()
                return resp.json()
            except Exception as err:  # noqa: BLE001 - retry any transport error
                last_err = err
                wait = self.backoff * (2 ** attempt)
                if isinstance(err, requests.HTTPError) and "429" in str(err):
                    wait = max(wait, 15.0)
                log.warning("Yahoo fetch failed (%s), retrying in %.0fs", err, wait)
                time.sleep(wait)
        raise ConnectionError(f"Yahoo Finance request failed after retries: {last_err}")

    @staticmethod
    def _parse_chart(payload: dict, symbol: str) -> pd.DataFrame:
        chart = payload.get("chart", {})
        if chart.get("error"):
            raise ValueError(f"Yahoo error for {symbol}: {chart['error']}")
        result = chart["result"][0]
        ts = result.get("timestamp")
        if not ts:
            raise ValueError(f"No data returned for {symbol}")
        quote = result["indicators"]["quote"][0]
        tz = result["meta"].get("exchangeTimezoneName", "UTC")
        index = pd.to_datetime(ts, unit="s", utc=True).tz_convert(tz)
        df = pd.DataFrame(
            {
                "open": quote["open"],
                "high": quote["high"],
                "low": quote["low"],
                "close": quote["close"],
                "volume": quote["volume"],
            },
            index=index,
        )
        df.index.name = "timestamp"
        # Drop bars Yahoo reports with null prices (halts, partial bars).
        df = df.dropna(subset=["close"])
        df["volume"] = df["volume"].fillna(0.0)
        df = df[~df.index.duplicated(keep="last")].sort_index()
        return df
