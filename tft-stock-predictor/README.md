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
| Data providers | `tft_predictor/data/` | `yahoo` (stocks/ETFs, plain-`requests` chart API client with retry + cookie priming) and `coinbase` (crypto, 24/7, no auth) |
| Features | `tft_predictor/data/features.py` | 11 observed features (returns, RSI, MACD, Bollinger %, ATR, realized vol, volume z-score, momentum) + 5 known-future calendar encodings |
| Real-time engine | `tft_predictor/realtime.py` | Polls for fresh bars, re-forecasts when a bar closes, optional **online learning** (gradient steps on newly labeled windows), emits console lines + `predictions.jsonl` |
| Live dashboard | `tft_predictor/dashboard.py` + `dashboard.html` | Zero-dependency web UI: price chart with quantile fan, signal/confidence tiles, forecast log; light + dark |
| Backtest | `tft_predictor/backtest.py` | Walk-forward holdout: quantile loss, interval coverage, directional accuracy, naive signal PnL |
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

# 2. Evaluate on the untrained chronological tail
python -m tft_predictor backtest --artifacts artifacts/BTC-USD_1h

# 3. One-shot forecast from the latest data
python -m tft_predictor predict --artifacts artifacts/BTC-USD_1h

# 4. Real-time loop: re-forecast whenever a new bar closes
python -m tft_predictor live --artifacts artifacts/BTC-USD_1h --refresh 60

# ... with online fine-tuning on each newly closed bar
python -m tft_predictor live --artifacts artifacts/BTC-USD_1h --online-learning

# ... with the live web dashboard at http://127.0.0.1:8000
python -m tft_predictor live --artifacts artifacts/BTC-USD_1h --dashboard 8000
```

## Live dashboard

`live --dashboard PORT` serves a zero-dependency web dashboard (stdlib HTTP
server + a single self-contained HTML page, no CDN or build step) that polls
the engine every few seconds and shows:

- **Price chart with forecast fan** — recent closes, the dashed median path,
  and shaded 50%/80% quantile bands, with a crosshair tooltip.
- **Stat tiles** — last close (with bar-over-bar delta), LONG/SHORT/FLAT
  signal, median forecast at the horizon, confidence meter, and band width.
- **Recent forecasts table** — the last dozen updates with expected move,
  band, signal, and confidence.

Light and dark themes follow the OS preference. Bind beyond localhost with
`--dashboard-host 0.0.0.0` if you need to reach it from another machine.

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

Interpretability tensors (attention weights, per-variable selection weights)
are returned by every forward pass and included in prediction results.

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

## Tests

```bash
python -m pytest tests/ -q
```

Runs offline (synthetic geometric-random-walk data): feature correctness,
window shapes, causal masking, pinball-loss math, quantile monotonicity, and
a full train → save → load → predict → backtest round trip.
