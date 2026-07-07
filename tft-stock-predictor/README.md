# TFT Stock Predictor

A **Temporal Fusion Transformer** (Lim et al., 2021) stock/crypto predictor,
implemented from scratch in PyTorch, that pulls live market data and keeps its
probabilistic forecast updated in real time as new bars close.

```
live prediction for BTC-USD every 60s — Ctrl-C to stop
[11:42:03Z] BTC-USD close=62737.85 (bar 11:00) | → 07-06 23:00: median=62810.12 [61995.40 … 63661.87] | signal=FLAT exp=+0.0012 conf=0.05
```

## What's inside

| Piece | Where | Notes |
|---|---|---|
| TFT model | `tft_predictor/model/` | Full paper architecture: variable selection networks, gated residual networks, static covariate encoders, LSTM seq2seq, interpretable multi-head attention (shared value head), quantile output |
| Quantile loss | `tft_predictor/model/loss.py` | Pinball loss over a configurable quantile set (default 0.1/0.25/0.5/0.75/0.9) |
| Conformal calibration | `tft_predictor/conformal.py` | CQR (Romano et al. 2019): post-hoc offsets fitted on the embargoed validation set give the bands a finite-sample coverage guarantee |
| Data providers | `tft_predictor/data/` | `yahoo` (stocks/ETFs, plain-`requests` chart API client with retry + cookie priming) and `coinbase` (crypto, 24/7, no auth) |
| Features | `tft_predictor/data/features.py` | 11 observed features (returns, RSI, MACD, Bollinger %, ATR, realized vol, volume z-score, momentum) + 5 known-future calendar encodings |
| Real-time engine | `tft_predictor/realtime.py` | Polls for fresh bars, re-forecasts when a bar closes, optional **online learning** (gradient steps on newly labeled windows), emits console lines + `predictions.jsonl` |
| Live dashboard | `tft_predictor/dashboard.py` + `dashboard.html` | Zero-dependency web UI: price chart with quantile fan, signal/confidence tiles, forecast log; light + dark |
| Backtest | `tft_predictor/backtest.py` | Walk-forward holdout: quantile loss, outer + inner interval coverage, directional accuracy, PnL of the exact live signal rule |
| Live evaluation | `tft_predictor/evaluation.py` | Scores matured live forecasts against realized closes: band coverage, directional accuracy, median error, signal performance |
| Tests | `tests/test_smoke.py` | Offline end-to-end suite on synthetic data (incl. a causality test on the attention mask) |

The forecast target is the **cumulative log return** at each horizon step, so
quantile outputs convert directly to price bands:
`price_t = last_close · exp(ŷ_t^{(q)})`.

## Install

```bash
cd tft-stock-predictor
pip install -r requirements.txt      # or: pip install -e .
# CPU-only torch: pip install --index-url https://download.pytorch.org/whl/cpu torch
```

## Usage

```bash
# 1. Train (fetches history automatically)
python -m tft_predictor train --tickers AAPL --interval 1h --lookback 365d --epochs 20
python -m tft_predictor train --tickers BTC-USD --provider coinbase --interval 1h --lookback 180d

# variants: deep ensemble, multi-asset (one model, ticker embedding), VLSTM
python -m tft_predictor train --tickers BTC-USD --provider coinbase --ensemble 3
python -m tft_predictor train --tickers BTC-USD ETH-USD SOL-USD --provider coinbase
python -m tft_predictor train --tickers BTC-USD --provider coinbase --no-attention

# 2. Evaluate on the untrained chronological tail
python -m tft_predictor backtest --artifacts artifacts/BTC-USD_1h

# 2b. Score past LIVE forecasts against what actually happened
python -m tft_predictor evaluate --artifacts artifacts/BTC-USD_1h

# 2c. Refresh a deployed model on latest data with its saved config
python -m tft_predictor retrain --artifacts artifacts/BTC-USD_1h

# 3. One-shot forecast from the latest data
python -m tft_predictor predict --artifacts artifacts/BTC-USD_1h

# 4. Real-time loop: re-forecast whenever a new bar closes
python -m tft_predictor live --artifacts artifacts/BTC-USD_1h --refresh 60

# ... with online fine-tuning on each newly closed bar
python -m tft_predictor live --artifacts artifacts/BTC-USD_1h --online-learning

# ... with the live web dashboard at http://127.0.0.1:8000
python -m tft_predictor live --artifacts artifacts/BTC-USD_1h --dashboard 8000

# ... POSTing the full forecast to a webhook whenever the signal changes
python -m tft_predictor live --artifacts artifacts/BTC-USD_1h --webhook https://example.com/hook
```

## Live dashboard

`live --dashboard PORT` serves a zero-dependency web dashboard (stdlib HTTP
server + a single self-contained HTML page, no CDN or build step) that polls
the engine every few seconds and shows:

- **Price chart with forecast fan** — recent closes, the dashed median path,
  and shaded 50%/80% quantile bands, with a crosshair tooltip.
- **Stat tiles** — last close (with bar-over-bar delta), LONG/SHORT/FLAT
  signal, median forecast at the horizon, confidence meter, and band width.
- **Live model health** — matured forecasts scored against realized closes
  (band coverage vs. target, directional accuracy, median error, signal hit
  rate). Coverage drifting well below nominal is the retrain signal.
- **What the model is looking at** — the TFT's variable-selection weights
  for the current forecast, as a ranked bar list.
- **Recent forecasts table** — the last dozen updates with expected move,
  band, signal, and confidence.

Light and dark themes follow the OS preference.

### Exposing the dashboard on a network

By default the dashboard binds to localhost only. To reach it from other
machines:

```bash
python -m tft_predictor live --artifacts artifacts/BTC-USD_1h \
    --dashboard 8000 --dashboard-public --dashboard-auth trader:S0mePassw0rd
```

- `--dashboard-public` binds on all interfaces (`0.0.0.0`); the CLI prints
  every reachable URL, including your LAN address.
- `--dashboard-auth USER:PASS` requires HTTP Basic credentials on every
  request (the browser prompts once). Without it, a public bind logs a
  loud warning — anyone who can reach the port sees your forecasts.
- Basic auth over plain HTTP is readable in transit. On networks you don't
  fully trust, front it with a TLS reverse proxy or keep it on localhost
  and use an SSH tunnel:

```bash
# TLS in one line with Caddy (auto-HTTPS on a public host)
caddy reverse-proxy --from dash.example.com --to localhost:8000

# ...or an SSH tunnel, no public exposure at all
ssh -L 8000:localhost:8000 user@trading-box   # then open http://localhost:8000
```

Each live update is appended to `artifacts/<run>/predictions.jsonl` (full
quantile price paths + trading signal), so dashboards or execution engines can
tail the file.

Multi-ticker training is supported (`--tickers AAPL MSFT NVDA`): the ticker
becomes a static covariate via an embedding, and one model serves all of them.

## Model details

Faithful to [Lim et al., *Temporal Fusion Transformers for Interpretable
Multi-horizon Time Series Forecasting* (2021)](https://arxiv.org/abs/1912.09363):

- **Variable selection networks** (static / encoder / decoder) learn
  instance-wise feature importances, conditioned on static context.
- **Static covariate encoders** — four GRNs produce the contexts that seed
  variable selection, temporal enrichment, and the LSTM initial state.
- **LSTM encoder–decoder** consumes past observed + known features and future
  known (calendar) features, wrapped in a gated skip connection.
- **Interpretable multi-head attention**: per-head queries/keys with a value
  projection *shared* across heads, causally masked; head outputs are averaged
  so attention weights read as temporal importance.
- **Gate–Add–Norm** skip connections throughout let the network suppress any
  block it doesn't need.
- **Quantile heads** give calibrated uncertainty bands, checked against
  empirical coverage in the backtest.

## Training & data recipe (research-backed)

Each choice below is an established finding from the forecasting / financial-ML
literature, applied to this codebase:

- **Purged & embargoed validation split** (López de Prado, *Advances in
  Financial ML*): a gap of one full horizon separates the last training label
  from the first validation label, so serially-correlated labels can't leak
  across the split and inflate validation scores.
- **Volatility-normalized targets**: the model learns returns divided by the
  origin's realized volatility, so one set of weights serves calm and stormy
  regimes; predictions are re-scaled by current vol at inference. Standard in
  momentum-network literature (Lim et al., *Enhancing Time Series Momentum
  Strategies*).
- **Robust feature scaling**: median/IQR instead of mean/std — fat-tailed
  return distributions mean a single crash bar can otherwise dominate scaling.
- **Range-based volatility features**: Parkinson (1980) high-low estimator is
  ~5x more efficient than close-to-close vol; plus a short/long vol-ratio
  regime indicator.
- **Warmup + cosine LR schedule** and **EMA weight averaging** (Polyak
  averaging): the EMA weights are what get validated and shipped — they
  generalize better than the last raw SGD iterate.
- **Deep ensembles** (Lakshminarayanan et al., 2017): `--ensemble N` trains N
  members from different seeds and averages their quantiles; member
  disagreement widens bands exactly where the data is ambiguous.
- **Conformalized quantile regression** (Romano et al., 2019): after training,
  per-horizon-step offsets are fitted on validation conformity scores and
  applied to every live band — a distribution-free coverage guarantee that
  holds even when the network is miscalibrated.
- **Experience replay for online learning**: live fine-tuning mixes fresh
  windows with randomly replayed historical windows, preventing catastrophic
  forgetting of older regimes.
- **SEMA (Switch EMA)**: the online model is reset to the EMA weights each
  epoch (arXiv:2402.09240) — verified to beat vanilla EMA, SWA, and Lookahead
  with zero extra cost.
- **Dual position sizing**: every signal carries both a fractional-Kelly size
  (quarter-Kelly on quantile-implied mean/variance) and a volatility-target
  size (position scaled so forecast risk hits a fixed target — the convention
  in the momentum-network benchmarks), each capped at 1x.

The full research pass behind these choices — every claim adversarially
verified with sources — is in [`docs/RESEARCH.md`](docs/RESEARCH.md), along
with the verified findings not yet implemented (Sharpe-objective training,
VLSTM hybrid, CPCV, greedy soups).

Interpretability tensors (attention weights, per-variable selection weights)
are returned by every forward pass. Each prediction includes
`variable_importance` — the mean selection weight per input feature — which
is written to `predictions.jsonl`, printed by `predict` ("top drivers"), and
charted on the dashboard.

## Trust loop

The backtest tells you how the model *would have* done; `evaluate` (and the
dashboard's health panel) tells you how the *deployed* model is actually
doing. Every live forecast is persisted; once its horizon elapses it is
scored against the realized close — band coverage vs. nominal, directional
accuracy, median error, and the hypothetical return of the signals. Both use
the same `trading_signal` rule, so backtest and live numbers are directly
comparable.

## Trading signal

`predict.trading_signal` converts horizon-end quantiles into
`LONG / SHORT / FLAT` with a confidence score (median edge vs. quantile
spread). It's intentionally simple — a demonstration of how to consume the
distributional forecast, not investment advice.

## Real-time behavior

- Predicts from **closed bars only** (the still-forming bar is excluded).
- New forecast is issued only when a new bar closes; polling cadence is
  `--refresh` seconds.
- `--online-learning` runs a few AdamW steps on the freshest fully-labeled
  windows each time a bar closes, so the model adapts intraday without a full
  retrain (a separate low learning rate is used).
- Network hiccups and rate limits are retried with exponential backoff; the
  loop never dies on a failed poll.

## Caveats

- Yahoo's public API rate-limits shared IPs aggressively; the client primes
  session cookies and backs off, but if you hammer it you'll wait. The
  Coinbase provider has generous public limits and trades 24/7.
- Future calendar features are generated by fixed interval steps, ignoring
  session boundaries for intraday equity data (harmless in practice — the
  decoder leans on the encoded history).
- Short-horizon return forecasting is *hard*; expect directional accuracy
  near 50% and wide, honest uncertainty bands. The value of the TFT here is
  calibrated distributions and interpretability, not a money printer.

## Deployment

- **Docker**: `docker build -t tft-predictor .` then run any CLI command;
  see the header of `Dockerfile` for train/live examples with a persistent
  artifacts volume.
- **CI**: GitHub Actions (`.github/workflows/tft-predictor-ci.yml` at the
  repo root) runs the test suite on every push touching this project.
- **Paper P&L**: the health panel and `evaluate` output include the
  cumulative return of vol-target-sized signals held to horizon, with max
  drawdown — a friction-free paper-trading ledger derived from the persisted
  forecasts.

## Tests

```bash
python -m pytest tests/ -q
```

Runs offline (synthetic geometric-random-walk data): feature correctness,
window shapes, causal masking, pinball-loss math, quantile monotonicity, and
a full train → save → load → predict → backtest round trip.
