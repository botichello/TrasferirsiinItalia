# Changelog

All notable changes to the TFT stock predictor, newest first. Dates are 2026.

## 0.4.0 — July 7 (ten-iteration improvement program)

- **Sharpe-objective training** (`--objective sharpe`): tanh position head
  trained end-to-end on negative Sharpe; produced the project's first
  fee-positive backtest (BTC hourly, ann. Sharpe 0.31 after 5 bps/side).
- **Validation-tuned signal threshold** stored in the config; annualized
  Sharpe/Sortino/drawdown/turnover in all evaluations; per-side transaction
  costs (`fee_bps`) everywhere PnL is computed.
- **Feature drift detection** (PSI vs training deciles) with a
  `retrain_recommended` flag, surfaced on the dashboard.
- **Auto-retrain** (`live --auto-retrain`): drift- or age-triggered
  background retraining with a validation gate and atomic hot swap.
- **Walk-forward evaluation** (`walkforward`): per-fold retraining on
  strictly-past data, deployment-style scoring, per-fold table.
- **Dashboard**: paper-equity curve with per-forecast coverage strip,
  drift and retrain status rows, `P(up)` on the signal tile.
- **Greedy model soups** (validation-guarded weight averaging) — deployed
  when they match the output-averaged ensemble at N× cheaper inference.
- **Per-horizon-step coverage** diagnostics in backtest/walkforward.
- **`report` command**: self-contained HTML tear-sheet per model.
- **Provider resilience**: Yahoo crumb auth, host rotation, Retry-After;
  Prometheus **`/metrics`** endpoint.
- `prob_up` (quantile-CDF probability of a positive move) in every signal;
  top-K-of-N ensemble selection (`--keep`).

## 0.3.0 — July 7 (production hardening)

- Multi-asset live mode (`--tickers A B C`) with a dashboard ticker
  switcher; on-disk bar cache for Coinbase (missing-span fetching).
- **Adaptive conformal inference**: live band expansion updated per matured
  forecast (misses widen, hits narrow); persisted per ticker.
- Public dashboard binding with HTTP Basic auth (`--dashboard-public`,
  `--dashboard-auth`); LAN URL discovery and no-auth warnings.

## 0.2.0 — July 6-7 (research-backed training & data recipe)

- Purged + embargoed validation split; robust (median/IQR) scaling;
  volatility-normalized targets; Parkinson volatility and vol-regime
  features; warmup+cosine LR; EMA weight averaging with SEMA switching;
  deep ensembles; **per-ticker conformalized quantile regression** with
  finite-sample coverage guarantees; fractional-Kelly and vol-target
  position sizing; experience-replay online learning; VLSTM variant
  (`--no-attention`).
- Deep-research pass (105 agents, adversarial verification):
  `docs/RESEARCH.md` maps every verified claim to the code.

## 0.1.0 — July 6 (initial system)

- From-scratch PyTorch TFT (VSNs, GRNs, static encoders, LSTM seq2seq,
  interpretable multi-head attention, quantile heads).
- Yahoo Finance + Coinbase providers; feature pipeline; training with
  early stopping; walk-forward-holdout backtest; realtime engine with
  online learning; live web dashboard; webhook alerts; live forecast
  evaluation (the trust loop); Docker + GitHub Actions CI.
