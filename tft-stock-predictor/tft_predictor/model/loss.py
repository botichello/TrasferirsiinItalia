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
