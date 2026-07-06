"""Lightweight live dashboard.

A stdlib HTTP server running on a daemon thread next to the realtime loop:
`/` serves a self-contained HTML page (no CDN, no build step) and
`/api/state` serves the engine's current snapshot as JSON. The page polls
the API every few seconds and re-renders the price chart, forecast fan,
signal tiles, and update log.
"""

from __future__ import annotations

import json
import logging
import threading
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .realtime import RealtimePredictor

log = logging.getLogger(__name__)

_PAGE_PATH = Path(__file__).with_name("dashboard.html")


class _Handler(BaseHTTPRequestHandler):
    def __init__(self, engine: RealtimePredictor, *args, **kwargs):
        self.engine = engine
        super().__init__(*args, **kwargs)

    def do_GET(self) -> None:  # noqa: N802 - stdlib API
        if self.path.split("?")[0] == "/api/state":
            body = json.dumps(self.engine.snapshot()).encode()
            self._respond(body, "application/json")
        elif self.path.split("?")[0] == "/":
            self._respond(_PAGE_PATH.read_bytes(), "text/html; charset=utf-8")
        else:
            self.send_error(404)

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
    def __init__(self, engine: RealtimePredictor, port: int = 8000,
                 host: str = "127.0.0.1"):
        self.httpd = ThreadingHTTPServer((host, port), partial(_Handler, engine))
        self._thread = threading.Thread(
            target=self.httpd.serve_forever, name="dashboard", daemon=True)
        self.url = f"http://{host}:{port}"

    def start(self) -> "DashboardServer":
        self._thread.start()
        log.info("dashboard serving at %s", self.url)
        return self

    def stop(self) -> None:
        self.httpd.shutdown()
