"""Command-line interface.

    python -m tft_predictor train    --tickers AAPL MSFT --interval 1h --epochs 20
    python -m tft_predictor predict  --artifacts artifacts/AAPL_1h
    python -m tft_predictor backtest --artifacts artifacts/AAPL_1h
    python -m tft_predictor live     --artifacts artifacts/AAPL_1h --refresh 60
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

import pandas as pd

from .backtest import backtest
from .config import TFTConfig, artifacts_dir
from .data import PROVIDERS, get_client
from .data.features import build_features
from .predict import predict_from_frame
from .realtime import RealtimePredictor
from .training import load_artifacts, train


def _add_train_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--tickers", nargs="+", default=["AAPL"])
    p.add_argument("--provider", choices=sorted(PROVIDERS), default="yahoo",
                   help="yahoo for stocks/ETFs, coinbase for crypto (24/7)")
    p.add_argument("--interval", default="1h")
    p.add_argument("--lookback", default="730d")
    p.add_argument("--encoder-length", type=int, default=96)
    p.add_argument("--horizon", type=int, default=12)
    p.add_argument("--hidden-size", type=int, default=64)
    p.add_argument("--heads", type=int, default=4)
    p.add_argument("--epochs", type=int, default=30)
    p.add_argument("--batch-size", type=int, default=64)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--ensemble", type=int, default=1, metavar="N",
                   help="train a deep ensemble of N members (different seeds)")
    p.add_argument("--keep", type=int, default=None, metavar="K",
                   help="keep only the top K ensemble members by val loss")
    p.add_argument("--no-attention", action="store_true",
                   help="VLSTM variant: variable selection + LSTM, no attention")
    p.add_argument("--objective", choices=["quantile", "sharpe"],
                   default="quantile",
                   help="quantile bands (default) or an end-to-end position "
                        "head trained on risk-adjusted returns")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tft_predictor")
    parser.add_argument("--artifacts-root", default="artifacts")
    sub = parser.add_subparsers(dest="command", required=True)

    p_train = sub.add_parser("train", help="fetch data and train a model")
    _add_train_args(p_train)

    p_retrain = sub.add_parser(
        "retrain", help="retrain from an existing artifact dir's config")
    p_retrain.add_argument("--artifacts", required=True)
    p_retrain.add_argument("--epochs", type=int, default=None,
                           help="override max epochs")

    for name, help_ in [("predict", "one-shot forecast from latest data"),
                        ("backtest", "single-split evaluation on holdout"),
                        ("walkforward", "rolling-origin eval with retraining per fold"),
                        ("evaluate", "score matured live forecasts vs realized prices"),
                        ("live", "real-time prediction loop")]:
        p = sub.add_parser(name, help=help_)
        p.add_argument("--artifacts", required=True,
                       help="path to a trained model dir, e.g. artifacts/AAPL_1h")
        p.add_argument("--ticker", default=None,
                       help="override ticker (defaults to first trained ticker)")
    sub.choices["live"].add_argument(
        "--tickers", nargs="+", default=None,
        help="run several tickers in one process (multi-asset live)")
    sub.choices["live"].add_argument("--refresh", type=int, default=None,
                                     help="seconds between polls")
    sub.choices["live"].add_argument("--online-learning", action="store_true",
                                     help="fine-tune on newly closed bars")
    sub.choices["live"].add_argument("--max-updates", type=int, default=None,
                                     help="stop after N forecasts (default: run forever)")
    sub.choices["live"].add_argument("--dashboard", type=int, default=None,
                                     metavar="PORT",
                                     help="serve the live dashboard on this port")
    sub.choices["live"].add_argument("--dashboard-host", default=None,
                                     help="dashboard bind address (default localhost)")
    sub.choices["live"].add_argument("--dashboard-public", action="store_true",
                                     help="bind the dashboard on all interfaces "
                                          "(shorthand for --dashboard-host 0.0.0.0)")
    sub.choices["live"].add_argument("--dashboard-auth", default=None,
                                     metavar="USER:PASS",
                                     help="require HTTP Basic credentials "
                                          "(strongly recommended with --dashboard-public)")
    sub.choices["live"].add_argument("--webhook", default=None, metavar="URL",
                                     help="POST the forecast here when the signal changes")
    sub.choices["live"].add_argument(
        "--auto-retrain", action="store_true",
        help="retrain in the background on drift (or --retrain-every-bars) "
             "and hot-swap when validation doesn't regress; single ticker only")
    sub.choices["live"].add_argument(
        "--retrain-every-bars", type=int, default=None, metavar="N",
        help="also retrain every N bars regardless of drift")
    for name in ("backtest", "evaluate", "walkforward"):
        sub.choices[name].add_argument(
            "--fee-bps", type=float, default=None,
            help="per-side transaction cost in basis points")
    sub.choices["walkforward"].add_argument("--folds", type=int, default=4)
    sub.choices["walkforward"].add_argument(
        "--epochs", type=int, default=None,
        help="override training epochs per fold (retraining is per-fold)")

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.command == "train":
        config = TFTConfig(
            tickers=args.tickers, provider=args.provider,
            interval=args.interval, lookback=args.lookback,
            encoder_length=args.encoder_length, horizon=args.horizon,
            hidden_size=args.hidden_size, attention_heads=args.heads,
            max_epochs=args.epochs, batch_size=args.batch_size,
            learning_rate=args.lr, ensemble_size=args.ensemble,
            ensemble_keep=args.keep, use_attention=not args.no_attention,
            objective=args.objective)
        _, history = train(config, artifacts=args.artifacts_root)
        out = artifacts_dir(config, args.artifacts_root)
        print(f"best val quantile loss: {history['best_val_loss']:.6f}")
        print(f"artifacts saved to {out}")
        return 0

    if args.command == "retrain":
        config = TFTConfig.load(Path(args.artifacts) / "config.json")
        if args.epochs is not None:
            config.max_epochs = args.epochs
        config.conformal = None  # refitted on the new validation split
        root = Path(args.artifacts).parent
        _, history = train(config, artifacts=root)
        print(f"best val quantile loss: {history['best_val_loss']:.6f}")
        print(f"artifacts refreshed in {artifacts_dir(config, root)}")
        return 0

    model, scaler, config = load_artifacts(args.artifacts)
    ticker = args.ticker or config.tickers[0]
    ticker_id = config.tickers.index(ticker) if ticker in config.tickers else 0

    if args.command == "predict":
        client = get_client(config.provider)
        ohlcv = client.fetch(ticker, interval=config.interval)
        features = build_features(ohlcv)
        result = predict_from_frame(model, scaler, config, features, ticker_id)
        _print_forecast(ticker, result)
        return 0

    if args.command == "backtest":
        client = get_client(config.provider)
        ohlcv = client.fetch(ticker, interval=config.interval, range_=config.lookback)
        features = build_features(ohlcv)
        results = backtest(model, scaler, config, features, ticker_id,
                           fee_bps=args.fee_bps)
        print(json.dumps(results, indent=2))
        return 0

    if args.command == "walkforward":
        from .walkforward import walkforward

        if args.epochs is not None:
            config.max_epochs = args.epochs
        client = get_client(config.provider)
        ohlcv = client.fetch(ticker, interval=config.interval,
                             range_=config.lookback)
        config.tickers = [ticker]
        results = walkforward(config, build_features(ohlcv),
                              n_folds=args.folds, fee_bps=args.fee_bps)
        print(json.dumps(results, indent=2))
        return 0

    if args.command == "evaluate":
        from .data.features import interval_to_timedelta
        from .evaluation import evaluate_file, read_records

        jsonl = Path(args.artifacts) / "predictions.jsonl"
        records = read_records(jsonl)
        if not records:
            print(f"no live forecasts recorded yet in {jsonl}")
            return 1
        # fetch just enough history to cover the recorded forecasts
        earliest = min(r["generated_at"] for r in records)
        days = max(2, int((pd.Timestamp.now(tz="UTC")
                           - pd.Timestamp(earliest)).days) + 2)
        client = get_client(config.provider)
        ohlcv = client.fetch(ticker, interval=config.interval, range_=f"{days}d")
        fee = config.fee_bps if args.fee_bps is None else args.fee_bps
        result = evaluate_file(jsonl, ohlcv["close"],
                               interval_to_timedelta(config.interval) / 2,
                               fee_bps=fee, ticker=ticker)
        print(json.dumps(result["summary"], indent=2))
        return 0

    if args.command == "live":
        from .realtime import run_many

        if args.refresh is not None:
            config.refresh_seconds = args.refresh
        if args.online_learning:
            config.online_learning = True
        tickers = args.tickers or [ticker]
        if args.auto_retrain and len(tickers) > 1:
            print("--auto-retrain supports a single ticker (engines share "
                  "the model; a per-ticker retrain would clobber the others)")
            return 1
        engines = [RealtimePredictor(model, scaler, config, ticker=t,
                                     out_dir=Path(args.artifacts),
                                     webhook_url=args.webhook,
                                     auto_retrain=args.auto_retrain,
                                     retrain_every_bars=args.retrain_every_bars)
                   for t in tickers]
        server = None
        if args.dashboard is not None:
            from .dashboard import DashboardServer
            host = args.dashboard_host or ("0.0.0.0" if args.dashboard_public
                                           else "127.0.0.1")
            server = DashboardServer(engines, port=args.dashboard, host=host,
                                     auth=args.dashboard_auth).start()
            print("dashboard: " + "  ".join(server.urls())
                  + ("  (basic auth)" if server.protected else ""))
            if host == "0.0.0.0" and not server.protected:
                print("WARNING: dashboard is open to the network without "
                      "authentication — add --dashboard-auth USER:PASS")
        print(f"live prediction for {', '.join(tickers)} every "
              f"{config.refresh_seconds}s "
              f"(online learning: {config.online_learning}) — Ctrl-C to stop")
        try:
            run_many(engines, config.refresh_seconds,
                     max_updates=args.max_updates)
        except KeyboardInterrupt:
            print("\nstopped")
        finally:
            if server is not None:
                server.stop()
        return 0

    return 1


def _print_forecast(ticker: str, result: dict) -> None:
    qs = result["quantiles"]
    print(f"\n{ticker} — last close {result['last_close']:.2f} "
          f"at {result['last_bar_time']}")
    print(f"signal: {result['signal']}")
    header = "timestamp".ljust(22) + "".join(f"q{q:g}".rjust(10) for q in qs)
    print(header)
    for ts, row in zip(result["timestamps"], result["price"]):
        print(f"{ts:%Y-%m-%d %H:%M}".ljust(22)
              + "".join(f"{p:10.2f}" for p in row))
    top = sorted(result["variable_importance"].items(),
                 key=lambda kv: -kv[1])[:5]
    print("top drivers: " + ", ".join(f"{k} {v:.0%}" for k, v in top))
