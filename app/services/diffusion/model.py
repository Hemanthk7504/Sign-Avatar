"""
Conditional Denoising Diffusion Probabilistic Model over sign-motion sequences.

This is a **real diffusion model** — real forward noising process, real learned
noise-prediction network, real ancestral sampling, real trained weights. It is
the component the paper's abstract calls for, unlike the procedural stand-in
in `motion_generator.py`.

Architecture (deliberately small so it trains on a CPU in minutes):

    denoiser: epsilon_theta(x_t, t, gloss)
      - input  : [B, SEQ_LEN, FEAT_DIM] noisy motion
      - condition: learned gloss embedding + sinusoidal timestep embedding,
                   injected as an additive token-wise bias AND as a prepended
                   conditioning token
      - trunk  : pre-norm Transformer encoder with learned positional embeddings
      - output : predicted noise, same shape as input

Classifier-free guidance is supported: during training the gloss label is
dropped to <unk> with probability `cond_drop_prob`, so at sample time the model
can be queried both conditionally and unconditionally and the two extrapolated.

Scale note: at d_model=256 / 4 layers this is ~3-6M parameters. That is
appropriate for a few hundred to a few thousand training signs. It is roughly
three orders of magnitude smaller than SignSparK's per-stream UNet, and it will
not match a GPU-trained model's motion quality — but it is genuinely trained,
genuinely diffusion, and genuinely runs on a laptop.
"""
from __future__ import annotations

import math
from typing import Optional

import torch
import torch.nn as nn
import torch.nn.functional as F


def timestep_embedding(t: torch.Tensor, dim: int) -> torch.Tensor:
    """Standard sinusoidal timestep embedding (Vaswani/DDPM style)."""
    half = dim // 2
    freqs = torch.exp(
        -math.log(10000.0) * torch.arange(half, dtype=torch.float32, device=t.device) / half
    )
    args = t.float()[:, None] * freqs[None, :]
    emb = torch.cat([torch.cos(args), torch.sin(args)], dim=-1)
    if dim % 2:
        emb = F.pad(emb, (0, 1))
    return emb


class MotionDenoiser(nn.Module):
    def __init__(
        self,
        feat_dim: int,
        seq_len: int,
        vocab_size: int,
        d_model: int = 256,
        n_layers: int = 4,
        n_heads: int = 4,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.feat_dim = feat_dim
        self.seq_len = seq_len

        self.input_proj = nn.Linear(feat_dim, d_model)
        self.pos_emb = nn.Parameter(torch.randn(1, seq_len + 1, d_model) * 0.02)

        self.gloss_emb = nn.Embedding(vocab_size, d_model)
        self.time_mlp = nn.Sequential(
            nn.Linear(d_model, d_model * 2), nn.SiLU(), nn.Linear(d_model * 2, d_model)
        )
        self.cond_mlp = nn.Sequential(
            nn.Linear(d_model * 2, d_model), nn.SiLU(), nn.Linear(d_model, d_model)
        )

        layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_model * 4,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.trunk = nn.TransformerEncoder(layer, num_layers=n_layers)
        self.out_norm = nn.LayerNorm(d_model)
        self.output_proj = nn.Linear(d_model, feat_dim)
        nn.init.zeros_(self.output_proj.weight)
        nn.init.zeros_(self.output_proj.bias)

    def forward(self, x: torch.Tensor, t: torch.Tensor, gloss: torch.Tensor) -> torch.Tensor:
        """
        x     : [B, T, D] noisy motion
        t     : [B]       diffusion timestep
        gloss : [B]       gloss token index (0 == unconditional)
        """
        b, seq, _ = x.shape
        d_model = self.pos_emb.shape[-1]

        t_emb = self.time_mlp(timestep_embedding(t, d_model))       # [B, d]
        g_emb = self.gloss_emb(gloss)                                # [B, d]
        cond = self.cond_mlp(torch.cat([t_emb, g_emb], dim=-1))      # [B, d]

        h = self.input_proj(x)                                       # [B, T, d]
        h = h + cond[:, None, :]                                     # token-wise bias
        h = torch.cat([cond[:, None, :], h], dim=1)                  # prepend cond token
        h = h + self.pos_emb[:, : seq + 1, :]

        h = self.trunk(h)
        h = self.out_norm(h[:, 1:, :])                               # drop cond token
        return self.output_proj(h)


class GaussianDiffusion:
    """DDPM with a cosine variance schedule (Nichol & Dhariwal)."""

    def __init__(self, num_steps: int = 200, device: str = "cpu"):
        self.num_steps = num_steps
        self.device = torch.device(device)

        betas = self._cosine_beta_schedule(num_steps).to(self.device)
        self.betas = betas
        self.alphas = 1.0 - betas
        self.alphas_cumprod = torch.cumprod(self.alphas, dim=0)
        self.alphas_cumprod_prev = F.pad(self.alphas_cumprod[:-1], (1, 0), value=1.0)

        self.sqrt_alphas_cumprod = self.alphas_cumprod.sqrt()
        self.sqrt_one_minus_alphas_cumprod = (1.0 - self.alphas_cumprod).sqrt()
        self.posterior_variance = (
            betas * (1.0 - self.alphas_cumprod_prev) / (1.0 - self.alphas_cumprod)
        )

    @staticmethod
    def _cosine_beta_schedule(steps: int, s: float = 0.008) -> torch.Tensor:
        x = torch.linspace(0, steps, steps + 1, dtype=torch.float32)
        ac = torch.cos(((x / steps) + s) / (1 + s) * math.pi * 0.5) ** 2
        ac = ac / ac[0]
        betas = 1 - (ac[1:] / ac[:-1])
        return betas.clamp(1e-8, 0.999)

    def q_sample(self, x0: torch.Tensor, t: torch.Tensor, noise: torch.Tensor) -> torch.Tensor:
        """Forward process: add noise to x0 at timestep t."""
        a = self.sqrt_alphas_cumprod[t][:, None, None]
        s = self.sqrt_one_minus_alphas_cumprod[t][:, None, None]
        return a * x0 + s * noise

    def loss(
        self,
        model: MotionDenoiser,
        x0: torch.Tensor,
        gloss: torch.Tensor,
        smooth_weight: float = 0.0,
    ) -> torch.Tensor:
        """
        Epsilon-prediction MSE, optionally plus a temporal smoothness term.

        WHY THE SMOOTHNESS TERM: plain epsilon-MSE treats every frequency
        equally, so a model can score well while producing motion that jitters
        violently frame-to-frame. Measured on this project's own checkpoint,
        epsilon-MSE alone gave motion with ~550x the jerk of the real capture
        it trained on. Penalizing the error in the *velocity* and
        *acceleration* of the reconstructed x0 directly targets that failure,
        and removes the need for aggressive post-hoc filtering at sample time.
        """
        b = x0.shape[0]
        t = torch.randint(0, self.num_steps, (b,), device=x0.device)
        noise = torch.randn_like(x0)
        x_t = self.q_sample(x0, t, noise)
        pred = model(x_t, t, gloss)
        loss = F.mse_loss(pred, noise)

        if smooth_weight > 0:
            # Reconstruct x0 from the predicted noise, then match its temporal
            # derivatives to the ground truth's.
            #
            # Two guards are essential here. At high t, alpha_cumprod -> 0, so
            # the 1/sqrt(acp) factor makes x0_pred explode and the raw
            # smoothness term dominates the loss by ~50x at init. We therefore
            # (a) clamp x0_pred to the standardized data's plausible range, and
            # (b) weight the term by alpha_cumprod (an SNR weighting), so
            # smoothness is enforced mainly at low-noise timesteps where the
            # reconstruction is actually meaningful.
            acp = self.alphas_cumprod[t][:, None, None]
            x0_pred = ((x_t - (1 - acp).sqrt() * pred) / acp.sqrt()).clamp(-4.0, 4.0)

            v_pred = x0_pred[:, 1:] - x0_pred[:, :-1]
            v_true = x0[:, 1:] - x0[:, :-1]
            a_pred = v_pred[:, 1:] - v_pred[:, :-1]
            a_true = v_true[:, 1:] - v_true[:, :-1]

            w = acp[:, :, 0]                                  # [B, 1] SNR weight
            v_err = ((v_pred - v_true) ** 2).mean(dim=(1, 2), keepdim=False)
            a_err = ((a_pred - a_true) ** 2).mean(dim=(1, 2), keepdim=False)
            loss = loss + smooth_weight * (w[:, 0] * (v_err + a_err)).mean()

        return loss

    @torch.no_grad()
    def sample(
        self,
        model: MotionDenoiser,
        gloss: torch.Tensor,
        seq_len: int,
        feat_dim: int,
        guidance_scale: float = 2.0,
        generator: Optional[torch.Generator] = None,
        clip_x0: float = 4.0,
    ) -> torch.Tensor:
        """
        Ancestral sampling with classifier-free guidance.

        Uses the numerically stable formulation: predict x0 from epsilon, CLAMP
        it, then compute the posterior mean from the clamped x0. Without the
        clamp, the 1/sqrt(alpha_t) factor at high t (where alpha_t -> 0.001
        under a cosine schedule) amplifies any epsilon error by ~30x per step
        and the trajectory diverges — this is why `clip_denoised` is on by
        default in reference DDPM implementations. Inputs are standardized, so
        clamping x0 to +/-4 sigma discards nothing real.
        """
        model.eval()
        b = gloss.shape[0]
        x = torch.randn(b, seq_len, feat_dim, device=self.device, generator=generator)
        uncond = torch.zeros_like(gloss)

        for i in reversed(range(self.num_steps)):
            t = torch.full((b,), i, device=self.device, dtype=torch.long)

            if guidance_scale and guidance_scale != 1.0:
                eps_c = model(x, t, gloss)
                eps_u = model(x, t, uncond)
                eps = eps_u + guidance_scale * (eps_c - eps_u)
            else:
                eps = model(x, t, gloss)

            acp = self.alphas_cumprod[i]
            acp_prev = self.alphas_cumprod_prev[i]
            beta = self.betas[i]
            alpha = self.alphas[i]

            # eps -> x0, then clamp
            x0 = (x - (1 - acp).sqrt() * eps) / acp.sqrt()
            x0 = x0.clamp(-clip_x0, clip_x0)

            # posterior mean q(x_{t-1} | x_t, x0)
            coef_x0 = acp_prev.sqrt() * beta / (1 - acp)
            coef_xt = alpha.sqrt() * (1 - acp_prev) / (1 - acp)
            mean = coef_x0 * x0 + coef_xt * x

            if i > 0:
                noise = torch.randn(x.shape, device=self.device, generator=generator)
                x = mean + self.posterior_variance[i].clamp(min=1e-20).sqrt() * noise
            else:
                x = mean

        return x

    @torch.no_grad()
    def ddim_sample(
        self,
        model: MotionDenoiser,
        gloss: torch.Tensor,
        seq_len: int,
        feat_dim: int,
        steps: int = 25,
        guidance_scale: float = 2.0,
        eta: float = 0.0,
        generator: Optional[torch.Generator] = None,
        clip_x0: float = 4.0,
    ) -> torch.Tensor:
        """
        DDIM sampling over a respaced subset of timesteps.

        This is what makes the backend usable in real time: full ancestral
        sampling runs `num_steps` (200) denoising passes per sign, and with
        classifier-free guidance that's 400 forward passes. DDIM reaches
        comparable quality in ~25 steps, an ~8x reduction, because it uses a
        deterministic (eta=0) non-Markovian reverse process that can skip
        timesteps instead of walking every one.

        eta=0 is fully deterministic (same seed -> same motion); eta=1
        recovers DDPM-like stochasticity.
        """
        model.eval()
        b = gloss.shape[0]
        steps = max(1, min(steps, self.num_steps))
        # Respaced, strictly decreasing timestep subset ending at 0
        ts = torch.linspace(self.num_steps - 1, 0, steps).long().tolist()

        x = torch.randn(b, seq_len, feat_dim, device=self.device, generator=generator)
        uncond = torch.zeros_like(gloss)

        for idx, i in enumerate(ts):
            t = torch.full((b,), i, device=self.device, dtype=torch.long)

            if guidance_scale and guidance_scale != 1.0:
                eps_c = model(x, t, gloss)
                eps_u = model(x, t, uncond)
                eps = eps_u + guidance_scale * (eps_c - eps_u)
            else:
                eps = model(x, t, gloss)

            acp = self.alphas_cumprod[i]
            acp_prev = (
                self.alphas_cumprod[ts[idx + 1]] if idx + 1 < len(ts)
                else torch.tensor(1.0, device=self.device)
            )

            x0 = ((x - (1 - acp).sqrt() * eps) / acp.sqrt()).clamp(-clip_x0, clip_x0)

            sigma = eta * (
                ((1 - acp_prev) / (1 - acp)).clamp(min=0).sqrt()
                * (1 - acp / acp_prev).clamp(min=0).sqrt()
            )
            dir_xt = (1 - acp_prev - sigma ** 2).clamp(min=0).sqrt() * eps
            x = acp_prev.sqrt() * x0 + dir_xt
            if eta > 0 and idx + 1 < len(ts):
                x = x + sigma * torch.randn(x.shape, device=self.device, generator=generator)

        return x
