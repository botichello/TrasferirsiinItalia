"""Static HTML tear-sheet: one self-contained file summarizing a model.

`python -m tft_predictor report --artifacts <dir>` runs the deployment-style
backtest (and live evaluation when forecasts have been recorded) and writes
`report.html` next to the model — a shareable artifact with the same visual
language as the live dashboard, no server required.
"""

from __future__ import annotations

import html
import json
from datetime import datetime, timezone
from pathlib import Path

_CSS = """
  :root { --surface:#fcfcfb; --page:#f9f9f7; --ink:#0b0b0b; --ink2:#52514e;
          --muted:#898781; --grid:#e1e0d9; --border:rgba(11,11,11,.10);
          --series:#2a78d6; --good:#006300; --bad:#d03b3b; }
  @media (prefers-color-scheme: dark) {
    :root { --surface:#1a1a19; --page:#0d0d0d; --ink:#fff; --ink2:#c3c2b7;
            --grid:#2c2c2a; --border:rgba(255,255,255,.10); --series:#3987e5;
            --good:#0ca30c; } }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--page); color:var(--ink);
         font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
  .wrap { max-width:900px; margin:0 auto; padding:28px 16px 48px; }
  h1 { font-size:22px; } h2 { font-size:15px; margin:0 0 10px; }
  .meta { color:var(--ink2); margin:4px 0 20px; }
  .chips { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px; }
  .chip { background:var(--surface); border:1px solid var(--border);
          border-radius:999px; padding:3px 12px; font-size:12px; color:var(--ink2); }
  .chip b { color:var(--ink); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
          gap:10px; margin-bottom:16px; }
  .tile { background:var(--surface); border:1px solid var(--border);
          border-radius:10px; padding:12px 14px; }
  .tile .l { font-size:12px; color:var(--muted); margin-bottom:4px; }
  .tile .v { font-size:20px; font-weight:650; }
  .tile .s { font-size:12px; color:var(--ink2); }
  .card { background:var(--surface); border:1px solid var(--border);
          border-radius:10px; padding:16px; margin-bottom:16px; }
  .up { color:var(--good); } .down { color:var(--bad); }
  .note { color:var(--muted); font-size:12px; margin-top:8px; }
  svg { display:block; width:100%; }
  footer { color:var(--muted); font-size:12px; }
"""


def _fmt(v, pct=False, digits=2):
    if v is None:
        return "–"
    if pct:
        return f"{v * 100:.{digits}f}%"
    return f"{v:.{digits}f}" if isinstance(v, float) else str(v)


def _tile(label, value, sub="", cls=""):
    return (f'<div class="tile"><div class="l">{label}</div>'
            f'<div class="v {cls}">{value}</div>'
            f'<div class="s">{sub}</div></div>')


def _coverage_svg(coverage_by_step, nominal) -> str:
    if not coverage_by_step:
        return ""
    n = len(coverage_by_step)
    W, H, pad = 720, 120, 24
    bw = (W - 2 * pad) / n
    y = lambda v: H - pad - v * (H - 2 * pad)  # noqa: E731
    bars = "".join(
        f'<rect x="{pad + i * bw + 2:.1f}" y="{y(c):.1f}" width="{bw - 4:.1f}" '
        f'height="{H - pad - y(c):.1f}" rx="3" fill="var(--series)" opacity="0.8"/>'
        f'<text x="{pad + i * bw + bw / 2:.1f}" y="{H - 8}" text-anchor="middle" '
        f'font-size="10" fill="var(--muted)">{i + 1}</text>'
        for i, c in enumerate(coverage_by_step))
    tgt = y(nominal)
    return (f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Coverage by horizon step">'
            f'{bars}'
            f'<line x1="{pad}" x2="{W - pad}" y1="{tgt:.1f}" y2="{tgt:.1f}" '
            f'stroke="var(--ink2)" stroke-width="1.5" stroke-dasharray="5 4"/>'
            f'<text x="{W - pad}" y="{tgt - 5:.1f}" text-anchor="end" font-size="11" '
            f'fill="var(--ink2)">target {nominal:.0%}</text></svg>')


def _equity_svg(returns: list[float]) -> str:
    if len(returns) < 2:
        return ""
    W, H, pad = 720, 140, 10
    cum, eq = 0.0, []
    for r in returns:
        cum += r
        eq.append(cum)
    lo, hi = min(0.0, *eq), max(0.0, *eq)
    X = lambda i: pad + i / (len(eq) - 1) * (W - 2 * pad)          # noqa: E731
    Y = lambda v: pad + (hi - v) / ((hi - lo) or 1) * (H - 2 * pad)  # noqa: E731
    path = "".join(f"{'L' if i else 'M'}{X(i):.1f} {Y(v):.1f}"
                   for i, v in enumerate(eq))
    return (f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Equity curve">'
            f'<line x1="{pad}" x2="{W - pad}" y1="{Y(0):.1f}" y2="{Y(0):.1f}" '
            f'stroke="var(--grid)"/>'
            f'<path d="{path}" fill="none" stroke="var(--series)" stroke-width="2"/></svg>')


def build_report(config, backtest_results: dict,
                 eval_results: dict | None = None,
                 walkforward_results: dict | None = None) -> str:
    bt = backtest_results
    tickers = ", ".join(config.tickers)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    chips = "".join(
        f'<span class="chip">{html.escape(k)} <b>{html.escape(str(v))}</b></span>'
        for k, v in [
            ("interval", config.interval), ("provider", config.provider),
            ("objective", config.objective),
            ("encoder", config.encoder_length), ("horizon", config.horizon),
            ("hidden", config.hidden_size),
            ("quantiles", "/".join(f"{q:g}" for q in config.quantiles)),
            ("threshold", f"{config.edge_threshold:g}"),
            ("fees", f"{bt.get('fee_bps_per_side', 0):g} bps/side"),
        ])

    if bt.get("objective") == "sharpe":
        tiles = (
            _tile("Total return", _fmt(bt["total_return"], pct=True),
                  cls="up" if bt["total_return"] >= 0 else "down")
            + _tile("Ann. Sharpe", _fmt(bt["annualized_sharpe"]))
            + _tile("Max drawdown", _fmt(bt["max_drawdown"], pct=True), cls="down")
            + _tile("Hit rate", _fmt(bt["hit_rate"], pct=True, digits=1))
            + _tile("Turnover/bar", _fmt(bt["turnover_per_bar"], pct=True, digits=1))
        )
        cov_card = ""
    else:
        tiles = (
            _tile("Band coverage", _fmt(bt["interval_coverage"], pct=True, digits=1),
                  f"target {_fmt(bt['nominal_coverage'], pct=True, digits=0)}")
            + _tile("Inner coverage", _fmt(bt.get("inner_coverage"), pct=True, digits=1),
                    f"target {_fmt(bt.get('inner_nominal'), pct=True, digits=0)}")
            + _tile("Directional acc.", _fmt(bt["directional_accuracy"], pct=True, digits=1))
            + _tile("Trades", str(bt["trades"]),
                    f"threshold {bt.get('edge_threshold', 0):g}")
            + _tile("Total return", _fmt(bt["total_return"], pct=True),
                    cls="up" if bt["total_return"] >= 0 else "down")
            + _tile("Ann. Sharpe", _fmt(bt.get("annualized_sharpe")))
            + _tile("Max drawdown", _fmt(bt.get("max_drawdown"), pct=True), cls="down")
        )
        cov_card = (f'<div class="card"><h2>Band coverage by horizon step '
                    f'(holdout, {bt["windows"]} windows)</h2>'
                    + _coverage_svg(bt.get("coverage_by_step"),
                                    bt.get("nominal_coverage", 0.8))
                    + '<div class="note">Each bar: how often the realized value '
                      'landed inside the outer band at that step. Dashed line: '
                      'the nominal target.</div></div>')

    wf_card = ""
    if walkforward_results:
        wf = walkforward_results
        rows = "".join(
            f"<tr><td>{f['fold'] + 1}</td><td>{html.escape(f['test_start'][:16])}</td>"
            f"<td>{f['windows']}</td><td>{_fmt(f['coverage'], pct=True, digits=1)}</td>"
            f"<td>{_fmt(f['directional_accuracy'], pct=True, digits=1)}</td>"
            f"<td>{f['trades']}</td><td>{_fmt(f['fold_return'], pct=True)}</td></tr>"
            for f in wf["folds"])
        wf_card = (
            '<div class="card"><h2>Walk-forward (retrained per fold)</h2>'
            f'<p class="note" style="margin:0 0 8px">coverage '
            f'{_fmt(wf["coverage"], pct=True, digits=1)} vs '
            f'{_fmt(wf["nominal_coverage"], pct=True, digits=0)} target · '
            f'directional {_fmt(wf["directional_accuracy"], pct=True, digits=1)} · '
            f'total {_fmt(wf["total_return"], pct=True)}</p>'
            '<table style="width:100%;border-collapse:collapse;font-size:13px">'
            '<tr style="color:var(--muted);font-size:12px;text-align:left">'
            '<th>fold</th><th>test start</th><th>windows</th><th>coverage</th>'
            '<th>direction</th><th>trades</th><th>return</th></tr>'
            f'{rows}</table></div>')

    live_card = ""
    if eval_results and eval_results["summary"].get("n_matured"):
        s = eval_results["summary"]
        rows = sorted(eval_results["rows"], key=lambda r: r["horizon_end"])
        live_card = (
            '<div class="card"><h2>Live forecasts scored against reality</h2>'
            '<div class="grid" style="margin-bottom:10px">'
            + _tile("Matured", f"{s['n_matured']} / {s['n_forecasts']}")
            + _tile("Band coverage", _fmt(s["band_coverage"], pct=True, digits=1),
                    f"target {_fmt(s.get('nominal_coverage'), pct=True, digits=0)}")
            + _tile("Paper P&L", _fmt(s.get("sized_total_return"), pct=True),
                    "vol-target sized",
                    cls="up" if (s.get("sized_total_return") or 0) >= 0 else "down")
            + _tile("Max drawdown", _fmt(s.get("max_drawdown"), pct=True), cls="down")
            + "</div>"
            + _equity_svg([r["sized_return"] for r in rows])
            + '<div class="note">Cumulative sized return of matured live '
              'signals, in forecast order.</div></div>')

    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(tickers)} — TFT model report</title><style>{_CSS}</style></head>
<body><div class="wrap">
<h1>{html.escape(tickers)} — model tear-sheet</h1>
<div class="meta">generated {now} · embargoed holdout, conformal + tuned
threshold applied — deployment conditions</div>
<div class="chips">{chips}</div>
<div class="grid">{tiles}</div>
{cov_card}{wf_card}{live_card}
<footer>Temporal Fusion Transformer stock predictor. Research tooling — not
investment advice.</footer>
</div></body></html>"""


def write_report(path: str | Path, *args, **kwargs) -> Path:
    out = Path(path) / "report.html"
    out.write_text(build_report(*args, **kwargs))
    return out


def load_json_if_exists(path: Path):
    return json.loads(path.read_text()) if path.exists() else None
