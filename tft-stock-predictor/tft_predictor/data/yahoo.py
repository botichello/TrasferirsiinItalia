"""Minimal Yahoo Finance chart-API client.

Uses plain `requests` (works behind TLS-re-terminating proxies where
curl-impersonation backends fail) with retry/backoff and session cookies.
Returns tidy OHLCV DataFrames indexed by timezone-aware timestamps.
"""

from __future__ import annotations

import logging
import random
import time

import pandas as pd
import requests

log = logging.getLogger(__name__)

_HOSTS = ("query1.finance.yahoo.com", "query2.finance.yahoo.com")
_CHART_URL = "https://{host}/v8/finance/chart/{symbol}"
_CRUMB_URL = "https://{host}/v1/test/getcrumb"
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


class _RateLimited(Exception):
    def __init__(self, retry_after: float | None = None):
        super().__init__("429 rate limited")
        self.retry_after = retry_after


class YahooFinanceClient:
    def __init__(self, max_retries: int = 4, backoff: float = 2.0, timeout: float = 30.0):
        self.session = requests.Session()
        self.session.headers.update(_HEADERS)
        self.max_retries = max_retries
        self.backoff = backoff
        self.timeout = timeout
        self._crumb: str | None = None

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
        payload = self._get_chart(symbol, params)
        return self._parse_chart(payload, symbol)

    def latest(self, symbol: str, interval: str = "1m") -> pd.DataFrame:
        """Most recent session of bars — used by the realtime loop."""
        range_ = "1d" if interval.endswith("m") else "5d"
        return self.fetch(symbol, interval=interval, range_=range_, include_prepost=False)

    # ------------------------------------------------------------------
    def _prime_cookies(self) -> None:
        """Yahoo rate-limits anonymous clients aggressively; a cookie from
        fc.yahoo.com (served on an error page, hence the bare try) plus a
        crumb makes the session look like a browser and lifts limits."""
        try:
            self.session.get("https://fc.yahoo.com", timeout=10)
        except requests.RequestException:
            pass
        for host in _HOSTS:
            try:
                resp = self.session.get(_CRUMB_URL.format(host=host), timeout=10)
                if resp.ok and resp.text and "<" not in resp.text:
                    self._crumb = resp.text.strip()
                    return
            except requests.RequestException:
                continue

    def _get_chart(self, symbol: str, params: dict) -> dict:
        """Chart request with host rotation, crumb auth, Retry-After
        respect, and jittered exponential backoff."""
        last_err: Exception | None = None
        for attempt in range(self.max_retries):
            host = _HOSTS[attempt % len(_HOSTS)]
            url = _CHART_URL.format(host=host, symbol=symbol)
            if self._crumb:
                params = {**params, "crumb": self._crumb}
            try:
                resp = self.session.get(url, params=params, timeout=self.timeout)
                if resp.status_code == 429:
                    if attempt == 0:
                        self._prime_cookies()
                    retry_after = resp.headers.get("Retry-After")
                    raise _RateLimited(float(retry_after) if retry_after else None)
                resp.raise_for_status()
                return resp.json()
            except Exception as err:  # noqa: BLE001 - retry any transport error
                last_err = err
                wait = self.backoff * (2 ** attempt) * random.uniform(0.8, 1.2)
                if isinstance(err, _RateLimited):
                    wait = err.retry_after if err.retry_after else max(wait, 15.0)
                log.warning("Yahoo fetch failed on %s (%s), retrying in %.0fs",
                            host, err, wait)
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
