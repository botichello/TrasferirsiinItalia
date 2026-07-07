"""Quantile (pinball) loss for probabilistic multi-horizon forecasting."""

from __future__ import annotations

import torch
import torch.nn as nn


class QuantileLoss(nn.Module):
    def __init__(self, quantiles: list[float]):
        super().__init__()
        self.register_buffer("quantiles", torch.tensor(quantiles).view(1, 1, -1))

    def forward(self, prediction: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        """prediction: (B, H, Q); target: (B, H)."""
        error = target.unsqueeze(-1) - prediction
        loss = torch.maximum(self.quantiles * error, (self.quantiles - 1) * error)
        return loss.mean()


class SharpeLoss(nn.Module):
    """Negative Sharpe ratio of the strategy implied by a position head.

    Positions p (B, H) in [-1, 1] applied to the window's per-step returns;
    each sample's strategy return is the mean step PnL, and the loss is the
    negative Sharpe across the batch. Training directly on risk-adjusted
    returns (rather than forecast error) is the objective used by the 2026
    momentum-network benchmark (arXiv:2603.01820).
    """

    def forward(self, position: torch.Tensor,
                cum_target: torch.Tensor) -> torch.Tensor:
        """position: (B, H); cum_target: (B, H) cumulative returns —
        per-step returns are recovered by differencing."""
        steps = torch.cat(
            [cum_target[:, :1], cum_target[:, 1:] - cum_target[:, :-1]], dim=1)
        strat = (position * steps).mean(dim=1)          # (B,)
        return -(strat.mean() / (strat.std() + 1e-9))
