from .coinbase import CoinbaseClient
from .dataset import FeatureScaler, WindowDataset, build_datasets
from .features import build_features, future_known_frame
from .yahoo import YahooFinanceClient

PROVIDERS = {"yahoo": YahooFinanceClient, "coinbase": CoinbaseClient}


def get_client(provider: str):
    """Instantiate a market-data client. `yahoo` covers stocks/ETFs;
    `coinbase` covers crypto pairs (24/7 — useful outside market hours)."""
    try:
        return PROVIDERS[provider]()
    except KeyError:
        raise ValueError(f"Unknown provider {provider!r}; "
                         f"choose from {list(PROVIDERS)}") from None


__all__ = [
    "YahooFinanceClient",
    "CoinbaseClient",
    "get_client",
    "PROVIDERS",
    "build_features",
    "future_known_frame",
    "FeatureScaler",
    "WindowDataset",
    "build_datasets",
]
