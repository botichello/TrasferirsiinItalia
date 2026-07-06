"""Temporal Fusion Transformer (Lim et al., 2021) in pure PyTorch.

Data flow, following the paper:

  inputs → variable selection (static / encoder / decoder)
         → LSTM encoder-decoder + gated skip
         → static enrichment GRN
         → interpretable multi-head self-attention (causal) + gated skip
         → position-wise GRN feed-forward
         → final gated skip over the temporal-fusion block
         → linear quantile heads on decoder positions
"""

from __future__ import annotations

import torch
import torch.nn as nn

from ..config import TFTConfig
from .layers import (
    GateAddNorm,
    GatedResidualNetwork,
    InterpretableMultiHeadAttention,
    VariableSelectionNetwork,
)


class EnsembleTFT(nn.Module):
    """Deep ensemble of independently trained TFTs (different seeds).

    Averaging the members' quantile outputs is a strong, simple uncertainty
    improvement (Lakshminarayanan et al., 2017): disagreement between members
    widens the effective bands exactly where the data is ambiguous.
    """

    def __init__(self, members: list[nn.Module]):
        super().__init__()
        if not members:
            raise ValueError("ensemble needs at least one member")
        self.members = nn.ModuleList(members)

    def forward(self, *args, **kwargs) -> dict[str, torch.Tensor]:
        outs = [m(*args, **kwargs) for m in self.members]
        return {key: torch.stack([o[key] for o in outs]).mean(dim=0)
                for key in outs[0]}


class TemporalFusionTransformer(nn.Module):
    def __init__(self, config: TFTConfig):
        super().__init__()
        self.config = config
        d = config.hidden_size
        n_obs = len(config.observed_features)
        n_known = len(config.known_features)
        if not n_obs or not n_known:
            raise ValueError("config.observed_features / known_features must be set")

        # --- input embeddings: each scalar series → d-dim vector ---
        self.obs_embed = nn.ModuleList(nn.Linear(1, d) for _ in range(n_obs))
        self.known_embed = nn.ModuleList(nn.Linear(1, d) for _ in range(n_known))
        self.static_embed = nn.Embedding(max(len(config.tickers), 1), d)

        # --- variable selection ---
        self.static_vsn = VariableSelectionNetwork(1, d, config.dropout)
        self.encoder_vsn = VariableSelectionNetwork(
            n_obs + n_known, d, config.dropout, context_size=d)
        self.decoder_vsn = VariableSelectionNetwork(
            n_known, d, config.dropout, context_size=d)

        # --- static context encoders (paper: 4 distinct GRNs) ---
        self.ctx_selection = GatedResidualNetwork(d, d, d, config.dropout)
        self.ctx_enrichment = GatedResidualNetwork(d, d, d, config.dropout)
        self.ctx_hidden = GatedResidualNetwork(d, d, d, config.dropout)
        self.ctx_cell = GatedResidualNetwork(d, d, d, config.dropout)

        # --- sequence-to-sequence layer ---
        self.encoder_lstm = nn.LSTM(d, d, config.lstm_layers, batch_first=True,
                                    dropout=config.dropout if config.lstm_layers > 1 else 0.0)
        self.decoder_lstm = nn.LSTM(d, d, config.lstm_layers, batch_first=True,
                                    dropout=config.dropout if config.lstm_layers > 1 else 0.0)
        self.post_lstm_gate = GateAddNorm(d, d, config.dropout)

        # --- temporal fusion decoder ---
        self.static_enrichment = GatedResidualNetwork(
            d, d, d, config.dropout, context_size=d)
        self.attention = InterpretableMultiHeadAttention(
            d, config.attention_heads, config.dropout)
        self.post_attn_gate = GateAddNorm(d, d, config.dropout)
        self.pos_wise_ff = GatedResidualNetwork(d, d, d, config.dropout)
        self.pre_output_gate = GateAddNorm(d, d, dropout=0.0)

        self.output_layer = nn.Linear(d, config.n_quantiles)

    # ------------------------------------------------------------------
    def forward(self, observed: torch.Tensor, known_enc: torch.Tensor,
                known_dec: torch.Tensor, static: torch.Tensor
                ) -> dict[str, torch.Tensor]:
        """
        observed:  (B, E, n_obs)   past observed features
        known_enc: (B, E, n_known) calendar features over the encoder span
        known_dec: (B, H, n_known) calendar features over the horizon
        static:    (B,)            ticker ids

        Returns dict with `prediction` (B, H, n_quantiles) and
        interpretability tensors (attention + variable selection weights).
        """
        E = observed.shape[1]

        # static covariates
        static_emb = self.static_embed(static).unsqueeze(-2)      # (B, 1, d)
        static_vec, static_weights = self.static_vsn(static_emb)  # (B, d)
        c_sel = self.ctx_selection(static_vec)
        c_enrich = self.ctx_enrichment(static_vec)
        c_h = self.ctx_hidden(static_vec)
        c_c = self.ctx_cell(static_vec)

        # per-variable embeddings
        enc_vars = torch.stack(
            [emb(observed[..., i:i + 1]) for i, emb in enumerate(self.obs_embed)]
            + [emb(known_enc[..., i:i + 1]) for i, emb in enumerate(self.known_embed)],
            dim=-2)                                               # (B, E, n_vars, d)
        dec_vars = torch.stack(
            [emb(known_dec[..., i:i + 1]) for i, emb in enumerate(self.known_embed)],
            dim=-2)                                               # (B, H, n_known, d)

        enc_in, enc_var_weights = self.encoder_vsn(enc_vars, c_sel)
        dec_in, dec_var_weights = self.decoder_vsn(dec_vars, c_sel)

        # LSTM encoder-decoder, static-initialized
        layers = self.config.lstm_layers
        h0 = c_h.unsqueeze(0).repeat(layers, 1, 1)
        c0 = c_c.unsqueeze(0).repeat(layers, 1, 1)
        enc_out, hidden = self.encoder_lstm(enc_in, (h0, c0))
        dec_out, _ = self.decoder_lstm(dec_in, hidden)

        lstm_out = torch.cat([enc_out, dec_out], dim=1)
        lstm_in = torch.cat([enc_in, dec_in], dim=1)
        temporal = self.post_lstm_gate(lstm_out, lstm_in)         # (B, E+H, d)

        # static enrichment + causal interpretable attention
        enriched = self.static_enrichment(temporal, c_enrich)
        T = enriched.shape[1]
        causal_mask = torch.triu(
            torch.ones(T, T, dtype=torch.bool, device=enriched.device), diagonal=1)
        attn_out, attn_weights = self.attention(
            enriched, enriched, enriched, mask=causal_mask)

        # decoder positions only from here on
        attn_dec = self.post_attn_gate(attn_out[:, E:], enriched[:, E:])
        ff = self.pos_wise_ff(attn_dec)
        fused = self.pre_output_gate(ff, temporal[:, E:])

        return {
            "prediction": self.output_layer(fused),              # (B, H, Q)
            "attention": attn_weights[:, E:],                    # (B, H, E+H)
            "static_weights": static_weights.squeeze(-1),
            "encoder_var_weights": enc_var_weights,              # (B, E, n_vars)
            "decoder_var_weights": dec_var_weights,              # (B, H, n_known)
        }
