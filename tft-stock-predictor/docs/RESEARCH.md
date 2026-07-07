# Research notes: SOTA techniques applied to this project

Findings from a deep-research pass (July 2026) over the 2022–2026 literature
on deep-learning financial time-series forecasting. Each claim below survived
adversarial verification (three independent verifiers attempting refutation;
vote shown). "Status" maps each finding to this codebase.

## Verified findings

### Training

| # | Finding | Source | Vote | Status |
|---|---|---|---|---|
| 1 | EMA of weights is a simple plug-in that improves generalization, calibration, robustness to noisy labels, and prediction consistency | [arXiv:2411.18704](https://arxiv.org/abs/2411.18704) | 2-1 | **Implemented** — EMA weights are validated and shipped (`training.ModelEMA`) |
| 2 | EMA reduces the need for LR decay; averaging suppresses SGD noise as implicit regularization | [arXiv:2411.18704](https://arxiv.org/abs/2411.18704) | 3-0 | Implemented (we keep cosine decay + EMA; compatible) |
| 3 | Switch EMA (SEMA): reset the online model to the EMA weights each epoch — a one-line change that beats vanilla EMA, SWA, and Lookahead, with no test-time cost | [arXiv:2402.09240](https://arxiv.org/pdf/2402.09240) | 3-0 ×3 claims | **Implemented** — `config.switch_ema` (default on) |
| 4 | EMA was selected by the hyperparameter tuner for TFT in *every* top configuration across datasets; deep seed-ensembles further improve TFT accuracy (e.g. 256-member: MAE 41.72→40.40 on Electricity) | [arXiv:2312.17100](https://arxiv.org/pdf/2312.17100) | 3-0 ×2 | **Implemented** — EMA default-on; `--ensemble N` |
| 5 | A 2026 futures benchmark ensembles the positions of the top-10 seeds (by val loss) of 50 runs as its core robustness technique | [arXiv:2603.01820](https://arxiv.org/abs/2603.01820) | 3-0 | Implemented in spirit (`--ensemble N` averages quantiles; top-K-of-N selection is future work) |
| 6 | Greedy model soups (add checkpoints to a weight-average only if held-out score doesn't degrade) are guaranteed no worse than the best single model | [ICML 2022, Wortsman et al.](https://proceedings.mlr.press/v162/wortsman22a/wortsman22a.pdf) | 3-0 | Future work — alternative to output-averaging ensembles |

### Validation & data

| # | Finding | Source | Vote | Status |
|---|---|---|---|---|
| 7 | Combinatorial Purged Cross-Validation (CPCV) has the lowest backtest-overfitting risk (PBO, Deflated Sharpe), beating K-Fold, Purged K-Fold, and Walk-Forward | [Knowledge-Based Systems 2024](https://www.sciencedirect.com/science/article/abs/pii/S0950705124011110) | 3-0 | Partially — we use a single purged+embargoed split; CPCV is future work |
| 8 | With a standardized pipeline (Adam, tuned LR, dropout, normalization fit on the training split only), deep models like TFT match or beat expert-featured XGBoost; no single model dominates | [arXiv:2312.17100](https://arxiv.org/pdf/2312.17100) | 3-0 | Implemented — scaler fit on train split only; robust variant default |

### Objectives & position sizing

| # | Finding | Source | Vote | Status |
|---|---|---|---|---|
| 9 | Positions sized by inverse-volatility scaling to a fixed target (w = ŷ·σ_tgt/σ) — volatility targeting, not Kelly — is the benchmark convention | [arXiv:2603.01820](https://arxiv.org/abs/2603.01820) | 3-0 | **Implemented** — `size_vol_target` in every signal, alongside fractional Kelly |
| 10 | Training end-to-end on a risk-adjusted objective (negative Sharpe of vol-scaled strategy returns) instead of forecast loss | [arXiv:2603.01820](https://arxiv.org/abs/2603.01820) | 3-0 | Future work — would replace quantile heads with position outputs |
| 11 | TFT reaches Sharpe 2.20 on daily futures (2010–2025), but a VSN+LSTM hybrid (VLSTM, 2.40) and LSTM+PatchTST (2.31) beat the full TFT — variable selection plus recurrence may matter more than attention | [arXiv:2603.01820](https://arxiv.org/abs/2603.01820) | 3-0 | Future work — a `--no-attention` VLSTM variant is a small change to `model/tft.py` |

## Unverified leads (verification was cut short by rate limits)

Treat as promising but unconfirmed:

- **EnCQR** (ensemble conformalized quantile regression): claimed to lift the
  exchangeability requirement of standard conformal methods for time series,
  making it a better fit for nonstationary markets than plain CQR.
- Purging/embargo mechanics claims from López de Prado (the technique is
  standard practice and implemented here; the specific quotes just weren't
  re-verified before the cutoff).

## In-house experiments (July 2026, Coinbase hourly bars)

Findings from running this codebase's own pipeline; all backtests are on
embargoed holdouts with CQR applied, i.e. deployment conditions.

**TFT vs. VLSTM (BTC-USD, 180d).** The benchmark's daily-futures result did
*not* transfer to intraday crypto with a quantile objective: the full TFT
beat the VLSTM variant on val quantile loss (0.720 single / 0.716 ensemble
vs. 0.737) and directional accuracy (49.1% vs. 42.5%). Both stayed
calibrated (CQR does its job regardless of architecture). Caveats: single
seed, quantile loss not a Sharpe objective, hourly crypto not daily futures.
`--no-attention` remains available for daily-bar experiments.

**Multi-asset model (BTC/ETH/SOL, 120d, one model via ticker embedding).**
Works: directional accuracy 48.7/51.8/52.3%. But it exposed a calibration
defect: conformal offsets fitted on *pooled* validation scores were right on
average and wrong per asset (coverage 84.2/78.2/76.5% vs. 80% nominal — the
quieter asset over-covered, the wilder one under-covered). Fitting offsets
**per ticker** (now the default; pooled kept as fallback) restored
per-asset coverage to 80.3/80.3/78.2% with no retraining.

**Sharpe-objective head (BTC-USD, 180d, 5 bps/side fees).** Implemented per
the benchmark: a tanh position head trained end-to-end on negative Sharpe
(`--objective sharpe`). On the embargoed holdout it produced the project's
first fee-positive strategy: +0.75% total over the holdout, annualized
Sharpe 0.31, hit rate 50.4%, max drawdown −6.9%, avg |position| 0.55,
turnover 5.3%/bar. Weak but positive — and a real contrast with the quantile
signal rule, which (honestly) stays flat on the same data. The two
objectives are complementary: quantile artifacts for calibrated bands and
risk, the Sharpe head for directional posture.

**Greedy soup vs. output-averaged ensemble.** Implemented with the
validation guard from the paper; at train time the soup is deployed
whenever it matches or beats the output-averaged ensemble on the embargoed
validation split (recorded in `history.json`). When deployed, inference
cost drops by the ensemble factor with no measured quality loss — on the
synthetic test suite the guard behaves exactly as the paper's no-worse
guarantee predicts.

**Drift → ACI in the wild.** During the July 7 session the live BTC drift
monitor flagged max PSI 1.16 (volatility-family features) against the
180-day training reference — a genuine vol-regime shift, which is exactly
the condition `--auto-retrain` responds to. Separately, on a 20-forecast
seeded ledger at exactly 80% empirical coverage, the ACI expansion summed
to precisely 0.0 (16 hits × γα down, 4 misses × γ(1−α) up) — the
controller's equilibrium arithmetic confirmed end-to-end.

## How this maps to defaults

Everything marked **Implemented** is on by default: robust scaling,
vol-normalized targets, embargoed split, warmup+cosine, EMA with SEMA
switching, CQR calibration, replay-buffer online learning, and dual sizing
outputs. Ensembling is opt-in (`--ensemble N`) since it multiplies training
cost.
