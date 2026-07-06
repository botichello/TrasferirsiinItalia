"""Building blocks of the Temporal Fusion Transformer (Lim et al., 2021).

Implements the paper's components: Gated Linear Units, Gate-Add-Norm skip
connections, Gated Residual Networks (with optional static context),
Variable Selection Networks, and Interpretable Multi-Head Attention with a
value projection shared across heads.
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F


class GatedLinearUnit(nn.Module):
    def __init__(self, input_size: int, output_size: int, dropout: float = 0.0):
        super().__init__()
        self.dropout = nn.Dropout(dropout)
        self.fc = nn.Linear(input_size, output_size * 2)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.fc(self.dropout(x))
        value, gate = x.chunk(2, dim=-1)
        return value * torch.sigmoid(gate)


class GateAddNorm(nn.Module):
    """LayerNorm(skip + GLU(x)) — the paper's gated skip connection."""

    def __init__(self, input_size: int, output_size: int, dropout: float = 0.0):
        super().__init__()
        self.glu = GatedLinearUnit(input_size, output_size, dropout)
        self.norm = nn.LayerNorm(output_size)

    def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        return self.norm(self.glu(x) + skip)


class GatedResidualNetwork(nn.Module):
    """GRN(a, c) = LayerNorm(residual(a) + GLU(W1 ELU(W2 a + W3 c)))."""

    def __init__(self, input_size: int, hidden_size: int, output_size: int,
                 dropout: float = 0.0, context_size: int | None = None):
        super().__init__()
        self.skip_proj = (nn.Linear(input_size, output_size)
                          if input_size != output_size else None)
        self.fc1 = nn.Linear(input_size, hidden_size)
        self.context_proj = (nn.Linear(context_size, hidden_size, bias=False)
                             if context_size else None)
        self.fc2 = nn.Linear(hidden_size, hidden_size)
        self.gate = GateAddNorm(hidden_size, output_size, dropout)

    def forward(self, a: torch.Tensor, context: torch.Tensor | None = None) -> torch.Tensor:
        skip = self.skip_proj(a) if self.skip_proj is not None else a
        hidden = self.fc1(a)
        if context is not None:
            if self.context_proj is None:
                raise ValueError("GRN built without context_size but got context")
            while context.dim() < hidden.dim():
                context = context.unsqueeze(-2)
            hidden = hidden + self.context_proj(context)
        hidden = self.fc2(F.elu(hidden))
        return self.gate(hidden, skip)


class VariableSelectionNetwork(nn.Module):
    """Learns instance-wise variable weights and a weighted combination.

    Each variable arrives already embedded to `hidden_size`; a flattened GRN
    (optionally conditioned on static context) produces softmax selection
    weights, and per-variable GRNs transform each input before mixing.
    """

    def __init__(self, n_vars: int, hidden_size: int, dropout: float = 0.0,
                 context_size: int | None = None):
        super().__init__()
        self.n_vars = n_vars
        self.flat_grn = GatedResidualNetwork(
            n_vars * hidden_size, hidden_size, n_vars,
            dropout=dropout, context_size=context_size)
        self.var_grns = nn.ModuleList(
            GatedResidualNetwork(hidden_size, hidden_size, hidden_size, dropout)
            for _ in range(n_vars))

    def forward(self, embedded: torch.Tensor,
                context: torch.Tensor | None = None
                ) -> tuple[torch.Tensor, torch.Tensor]:
        """embedded: (..., n_vars, hidden). Returns (mixed, weights)."""
        flat = embedded.flatten(start_dim=-2)
        weights = F.softmax(self.flat_grn(flat, context), dim=-1)  # (..., n_vars)
        transformed = torch.stack(
            [grn(embedded[..., i, :]) for i, grn in enumerate(self.var_grns)],
            dim=-2)
        mixed = (transformed * weights.unsqueeze(-1)).sum(dim=-2)
        return mixed, weights


class InterpretableMultiHeadAttention(nn.Module):
    """Multi-head attention with a single value head shared across heads.

    Head outputs are averaged (not concatenated), so the aggregate attention
    matrix is directly interpretable as temporal importance.
    """

    def __init__(self, hidden_size: int, n_heads: int, dropout: float = 0.0):
        super().__init__()
        if hidden_size % n_heads:
            raise ValueError("hidden_size must be divisible by n_heads")
        self.n_heads = n_heads
        self.d_head = hidden_size // n_heads
        self.q_proj = nn.Linear(hidden_size, n_heads * self.d_head)
        self.k_proj = nn.Linear(hidden_size, n_heads * self.d_head)
        self.v_proj = nn.Linear(hidden_size, self.d_head)   # shared across heads
        self.out_proj = nn.Linear(self.d_head, hidden_size)
        self.dropout = nn.Dropout(dropout)

    def forward(self, query: torch.Tensor, key: torch.Tensor, value: torch.Tensor,
                mask: torch.Tensor | None = None
                ) -> tuple[torch.Tensor, torch.Tensor]:
        """query: (B, Tq, d); key/value: (B, Tk, d); mask: (Tq, Tk) bool,
        True = blocked. Returns (output (B, Tq, d), attn (B, Tq, Tk))."""
        B, Tq, _ = query.shape
        Tk = key.shape[1]
        q = self.q_proj(query).view(B, Tq, self.n_heads, self.d_head).transpose(1, 2)
        k = self.k_proj(key).view(B, Tk, self.n_heads, self.d_head).transpose(1, 2)
        v = self.v_proj(value)                                   # (B, Tk, d_head)

        scores = q @ k.transpose(-2, -1) / math.sqrt(self.d_head)  # (B, H, Tq, Tk)
        if mask is not None:
            scores = scores.masked_fill(mask, float("-inf"))
        attn = self.dropout(F.softmax(scores, dim=-1))
        heads = attn @ v.unsqueeze(1)                            # (B, H, Tq, d_head)
        mean_head = heads.mean(dim=1)                            # (B, Tq, d_head)
        return self.out_proj(mean_head), attn.mean(dim=1)
