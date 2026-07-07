"""Lightweight live dashboard.

A stdlib HTTP server running on a daemon thread next to the realtime loop:
`/` serves a self-contained HTML page (no CDN, no build step) and
`/api/state` serves the engine's current snapshot as JSON. The page polls
the API every few seconds and re-renders the price chart, forecast fan,
signal tiles, and update log.

By default the server binds to localhost. To reach it from other machines,
bind to 0.0.0.0 and (strongly recommended) set HTTP Basic credentials —
the handler answers 401 until the browser supplies them. Basic auth over
plain HTTP is readable in transit: on untrusted networks put the dashboard
behind a TLS reverse proxy (Caddy, nginx) or an SSH tunnel.
"""

from __future__ import annotations

import base64
import hmac
import json
import logging
import socket
import threading
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .realtime import RealtimePredictor

log = logging.getLogger(__name__)

_PAGE_PATH = Path(__file__).with_name("dashboard.html")


def _json_fallback(obj):
    """Serialize numpy scalars (np.bool_, np.float32, ...) transparently."""
    if hasattr(obj, "item"):
        return obj.item()
    raise TypeError(f"not JSON serializable: {type(obj).__name__}")


class _Handler(BaseHTTPRequestHandler):
    def __init__(self, engines: dict[str, RealtimePredictor],
                 auth_header: str | None, *args, **kwargs):
        self.engines = engines
        self.auth_header = auth_header
        super().__init__(*args, **kwargs)

    def do_GET(self) -> None:  # noqa: N802 - stdlib API
        if not self._authorized():
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="TFT dashboard"')
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            requested = parse_qs(parsed.query).get("ticker", [None])[0]
            engine = self.engines.get(requested) or next(iter(self.engines.values()))
            state = engine.snapshot()
            state["tickers"] = list(self.engines)
            body = json.dumps(state, default=_json_fallback).encode()
            self._respond(body, "application/json")
        elif parsed.path == "/":
            self._respond(_PAGE_PATH.read_bytes(), "text/html; charset=utf-8")
        else:
            self.send_error(404)

    def _authorized(self) -> bool:
        if self.auth_header is None:
            return True
        supplied = self.headers.get("Authorization", "")
        return hmac.compare_digest(supplied, self.auth_header)

    def _respond(self, body: bytes, content_type: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:  # keep the console for forecasts
        pass


class DashboardServer:
    def __init__(self, engine: "RealtimePredictor | dict[str, RealtimePredictor] | list[RealtimePredictor]",
                 port: int = 8000, host: str = "127.0.0.1",
                 auth: str | None = None):
        """`engine` may be a single engine, a list, or a {ticker: engine}
        dict — the dashboard serves them all with a ticker switcher.
        `auth` is "user:password"; when set, every request must carry
        matching HTTP Basic credentials."""
        if isinstance(engine, RealtimePredictor):
            engines = {engine.ticker: engine}
        elif isinstance(engine, dict):
            engines = engine
        else:
            engines = {e.ticker: e for e in engine}
        if not engines:
            raise ValueError("dashboard needs at least one engine")
        auth_header = None
        if auth:
            if ":" not in auth:
                raise ValueError("--dashboard-auth expects USER:PASSWORD")
            auth_header = "Basic " + base64.b64encode(auth.encode()).decode()
        self.httpd = ThreadingHTTPServer(
            (host, port), partial(_Handler, engines, auth_header))
        self._thread = threading.Thread(
            target=self.httpd.serve_forever, name="dashboard", daemon=True)
        self.host = host
        self.port = self.httpd.server_address[1]
        self.protected = auth_header is not None
        self.url = f"http://{host}:{self.port}"

    def urls(self) -> list[str]:
        """Reachable URLs — resolves the machine's LAN address when bound
        to all interfaces."""
        if self.host != "0.0.0.0":
            return [self.url]
        urls = [f"http://127.0.0.1:{self.port}"]
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))  # no traffic sent; picks the route
                urls.append(f"http://{s.getsockname()[0]}:{self.port}")
        except OSError:
            pass
        return urls

    def start(self) -> "DashboardServer":
        self._thread.start()
        log.info("dashboard serving at %s", ", ".join(self.urls()))
        if self.host == "0.0.0.0" and not self.protected:
            log.warning("dashboard is reachable from the network WITHOUT "
                        "authentication — consider --dashboard-auth USER:PASS")
        return self

    def stop(self) -> None:
        self.httpd.shutdown()
