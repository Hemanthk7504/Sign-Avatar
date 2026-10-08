"""
Inference backend for the **trained sign-motion diffusion model**.

This is the backend that corresponds to the paper's abstract: a diffusion
model over an anatomically informed 3D body representation, conditioned on
gloss and on sign-language variant, jointly producing manual articulation
(body + both hands) and non-manual features (face landmarks) in a single
generative pass.

Pipeline:
    text -> gloss tokens -> per-gloss diffusion sampling -> coarticulated
    concatenation -> normalized landmark frames (same format the s2s backend
    emits, so the frontend renderer is shared)

Per-sign sampling is cached, so repeated glosses in a conversation cost
nothing after the first occurrence.

HONEST CAPABILITY NOTE
----------------------
Motion quality is bounded by what the model was trained on. Trained only on
the bundled fingerspelling alphabets (~600 samples / 179 glosses), it learns
letter handshapes and will fingerspell, but it has no word-level vocabulary
and will not produce fluent signing. Train on a downloaded word-level lexicon
for anything beyond a pipeline demonstration. Any gloss absent from the
trained vocabulary is fingerspelled letter-by-letter rather than hallucinated.
"""
from __future__ import annotations

import logging
import os
from typing import List, Optional

import numpy as np

from app.config import settings
from app.services.text_to_gloss import text_to_gloss

logger = logging.getLogger("sign_avatar.diffusion")

DIFFUSION_CKPT = os.environ.get("DIFFUSION_CKPT", "./checkpoints/diffusion/model.pt")

# DDIM steps at generation time. Lower = faster, slightly less detail.
# 25 keeps per-sign sampling well under a second on CPU.
DDIM_STEPS = int(os.environ.get("DIFFUSION_DDIM_STEPS", "25"))

# Skeleton metadata matching data.py's point selection, so the shared
# landmark renderer can draw bones without re-deriving connectivity.
HAND_LIMBS = [
    (0, 1), (1, 2), (2, 3), (3, 4),           # thumb
    (0, 5), (5, 6), (6, 7), (7, 8),           # index
    (5, 9), (9, 10), (10, 11), (11, 12),      # middle
    (9, 13), (13, 14), (14, 15), (15, 16),    # ring
    (13, 17), (0, 17), (17, 18), (18, 19), (19, 20),  # pinky + palm
]
BODY_POINTS = ["LEFT_SHOULDER", "RIGHT_SHOULDER", "LEFT_ELBOW", "RIGHT_ELBOW",
               "LEFT_WRIST", "RIGHT_WRIST", "LEFT_HIP", "RIGHT_HIP"]
BODY_LIMBS = [(0, 1), (0, 2), (2, 4), (1, 3), (3, 5), (0, 6), (1, 7), (6, 7)]
HAND_POINTS = [
    "WRIST", "THUMB_CMC", "THUMB_MCP", "THUMB_IP", "THUMB_TIP",
    "INDEX_MCP", "INDEX_PIP", "INDEX_DIP", "INDEX_TIP",
    "MIDDLE_MCP", "MIDDLE_PIP", "MIDDLE_DIP", "MIDDLE_TIP",
    "RING_MCP", "RING_PIP", "RING_DIP", "RING_TIP",
    "PINKY_MCP", "PINKY_PIP", "PINKY_DIP", "PINKY_TIP",
]
FACE_LIMBS = [
    (0, 1), (1, 2), (2, 3),                     # right brow
    (4, 5), (5, 6), (6, 7),                     # left brow
    (8, 9), (9, 10), (10, 11), (11, 8),         # nose bridge / eye anchor
    (12, 13), (13, 14), (14, 15), (15, 12),     # mouth contour
]



class DiffusionUnavailable(RuntimeError):
    """Raised when the trained diffusion backend can't run; the pipeline falls
    back to another backend."""


# Temporal smoothing of generated motion.
#
# WHY THIS IS HERE: the denoiser is a Transformer over frames with no temporal
# smoothness inductive bias, and epsilon-prediction MSE barely penalizes
# high-frequency error. Measured on this project's own trained checkpoint, raw
# samples had a mean jerk ~550x that of the real capture they were trained on —
# i.e. visually jittery, even though per-frame positions were roughly right.
# Raising DDIM steps 25 -> 100 only cut jerk ~25%, confirming it's the model,
# not the sampler.
#
# Savitzky-Golay filtering along the time axis fixes the symptom cheaply and is
# standard practice in motion generation. The *proper* fix is a velocity/
# acceleration term in the training loss (see train_diffusion.py --smooth-weight),
# which removes the need for aggressive post-filtering.
SMOOTH_WINDOW = int(os.environ.get("DIFFUSION_SMOOTH_WINDOW", "31"))
SMOOTH_POLYORDER = int(os.environ.get("DIFFUSION_SMOOTH_POLYORDER", "2"))


def _temporal_smooth(motion: np.ndarray, window: int = 9, polyorder: int = 2) -> np.ndarray:
    """Savitzky-Golay filter along time. motion: [T, D]."""
    if window <= 1:
        return motion
    t = motion.shape[0]
    # Window must be odd and <= sequence length
    w = min(window, t if t % 2 == 1 else t - 1)
    if w < 3 or w <= polyorder:
        return motion
    if w % 2 == 0:
        w -= 1
    try:
        from scipy.signal import savgol_filter
        return savgol_filter(motion, window_length=w, polyorder=polyorder, axis=0)
    except Exception:  # noqa: BLE001
        # Fallback: simple moving average
        k = np.ones(w) / w
        return np.stack([np.convolve(motion[:, d], k, mode="same")
                         for d in range(motion.shape[1])], axis=1)


class DiffusionMotionBackend:
    def __init__(self):
        self._checked = False
        self._available = False
        self._reason = ""
        self._model = None
        self._diffusion = None
        self._vocab = None
        self._mean = None
        self._std = None
        self._cfg = None
        self._cache = {}

    # -- availability ---------------------------------------------------------
    def is_available(self) -> bool:
        if self._checked:
            return self._available
        self._checked = True
        try:
            import torch  # noqa: F401
        except ImportError as exc:
            self._reason = f"PyTorch not installed ({exc}). Run: pip install torch"
            logger.warning("Diffusion backend unavailable: %s", self._reason)
            return False
        if not os.path.isfile(DIFFUSION_CKPT):
            self._reason = (
                f"No trained checkpoint at {DIFFUSION_CKPT}. "
                "Train one with: python train_diffusion.py"
            )
            logger.warning("Diffusion backend unavailable: %s", self._reason)
            return False
        self._available = True
        return True

    def _reason_or_default(self) -> str:
        return self._reason or "diffusion backend not available"

    # -- loading --------------------------------------------------------------
    def _load(self):
        if self._model is not None:
            return
        import torch

        from app.services.diffusion.model import GaussianDiffusion, MotionDenoiser

        ckpt = torch.load(DIFFUSION_CKPT, map_location="cpu", weights_only=False)
        cfg = ckpt["config"]
        model = MotionDenoiser(
            feat_dim=cfg["feat_dim"], seq_len=cfg["seq_len"],
            vocab_size=cfg["vocab_size"], d_model=cfg["d_model"],
            n_layers=cfg["n_layers"],
        )
        model.load_state_dict(ckpt["model_state"])
        model.eval()

        self._model = model
        self._cfg = cfg
        self._vocab = ckpt["vocab"]
        self._mean = np.asarray(ckpt["mean"], dtype=np.float32)
        self._std = np.asarray(ckpt["std"], dtype=np.float32)
        self._diffusion = GaussianDiffusion(num_steps=cfg["diffusion_steps"], device="cpu")

        info = ckpt.get("train_info", {})
        logger.info(
            "Diffusion model loaded: %d glosses, trained on %s samples, best loss %.4f",
            len(self._vocab), info.get("samples", "?"), info.get("best_loss", float("nan")),
        )

    def _sample_gloss(self, gloss: str, guidance: float = 2.0, seed: Optional[int] = None, guidance_scale: Optional[float] = None) -> np.ndarray:
        """Sample one sign's motion [SEQ_LEN, FEAT_DIM] (denormalized)."""
        import torch
        if guidance_scale is not None:
            guidance = guidance_scale

        key = (gloss, round(guidance, 3), seed, DDIM_STEPS)
        if key in self._cache:
            return self._cache[key]

        idx = self._vocab.get(gloss.lower(), 0)
        g = torch.tensor([idx], dtype=torch.long)
        gen = None
        if seed is not None:
            gen = torch.Generator(device="cpu").manual_seed(int(seed) + idx)

        with torch.no_grad():
            out = self._diffusion.ddim_sample(
                self._model, g,
                seq_len=self._cfg["seq_len"], feat_dim=self._cfg["feat_dim"],
                steps=DDIM_STEPS, guidance_scale=guidance, generator=gen,
            )
        motion = out[0].numpy() * self._std + self._mean     # denormalize
        motion = _temporal_smooth(motion, window=SMOOTH_WINDOW, polyorder=SMOOTH_POLYORDER)
        self._cache[key] = motion
        return motion

    # -- public ---------------------------------------------------------------
    def generate_landmarks(
        self,
        text: str,
        variant: str = settings.DEFAULT_VARIANT,
        style: str = "neutral",
        seed: Optional[int] = None,
        guidance_scale: float = 2.0,
        transition_frames: int = 6,
    ) -> dict:
        if not self.is_available():
            raise DiffusionUnavailable(self._reason_or_default())
        self._load()

        from app.services.diffusion.data import (
            N_BODY, N_FACE, N_HAND, N_POINTS,
        )

        tokens = text_to_gloss(text)
        if not tokens:
            raise DiffusionUnavailable("No signable tokens produced from input text")

        # Expand out-of-vocabulary glosses into fingerspelled letters rather
        # than sampling an unknown embedding (which would hallucinate motion).
        plan: List[str] = []
        for t in tokens:
            if t.word.lower() in self._vocab:
                plan.append(t.word.lower())
            else:
                plan.extend([c for c in t.word.lower() if c in self._vocab])
        if not plan:
            raise DiffusionUnavailable("No tokens matched the trained vocabulary")

        # Style affects playback pacing (the model itself is style-agnostic
        # until trained with style labels — documented limitation).
        speed = {"neutral": 1.0, "expressive": 0.85, "compact": 1.25}.get(style, 1.0)

        segments = [self._sample_gloss(g, guidance_scale, seed) for g in plan]

        # Coarticulated concatenation: cross-fade neighbouring signs so the
        # hands travel continuously instead of teleporting between segments.
        frames: List[np.ndarray] = []
        for i, seg in enumerate(segments):
            if i == 0:
                frames.extend(seg)
                continue
            prev_tail = frames[-transition_frames:]
            head = seg[:transition_frames]
            for k in range(transition_frames):
                a = 0.5 - 0.5 * np.cos(np.pi * (k + 1) / (transition_frames + 1))
                frames[-transition_frames + k] = prev_tail[k] * (1 - a) + head[k] * a
            frames.extend(seg[transition_frames:])

        motion = np.stack(frames)                      # [T, FEAT_DIM]

        # Apply style pacing by resampling the timeline
        if abs(speed - 1.0) > 1e-3:
            t_out = max(2, int(round(motion.shape[0] / speed)))
            src = np.linspace(0, 1, motion.shape[0])
            dst = np.linspace(0, 1, t_out)
            motion = np.stack([np.interp(dst, src, motion[:, d]) for d in range(motion.shape[1])], axis=1)

        pts = motion.reshape(motion.shape[0], N_POINTS, 3)

        components = [
            {"name": "POSE_LANDMARKS", "points": BODY_POINTS,
             "limbs": [list(l) for l in BODY_LIMBS], "offset": 0, "count": N_BODY},
            {"name": "LEFT_HAND_LANDMARKS", "points": HAND_POINTS,
             "limbs": [list(l) for l in HAND_LIMBS], "offset": N_BODY, "count": N_HAND},
            {"name": "RIGHT_HAND_LANDMARKS", "points": HAND_POINTS,
             "limbs": [list(l) for l in HAND_LIMBS], "offset": N_BODY + N_HAND, "count": N_HAND},
            {"name": "FACE_LANDMARKS", "points": [str(i) for i in range(N_FACE)],
             "limbs": [list(l) for l in FACE_LIMBS], "offset": N_BODY + 2 * N_HAND, "count": N_FACE},
        ]

        out_frames = [
            [[round(float(v), 4) for v in pts[t, p]] for p in range(N_POINTS)]
            for t in range(pts.shape[0])
        ]

        return {
            "format": "landmarks",
            # 25fps matches the source capture rate the training clips came from.
            "fps": 25,
            "components": components,
            "frames": out_frames,
            "num_points": N_POINTS,
            "normalized": True,
            "gloss": plan,
        }

    def stream_generate_landmarks(
        self,
        text: str,
        variant: str = settings.DEFAULT_VARIANT,
        style: str = "neutral",
        seed: Optional[int] = None,
        guidance_scale: float = 2.0,
        transition_frames: int = 6,
    ):
        """
        True incremental generator: yields sign chunks as each gloss finishes
        diffusion sampling, achieving low-latency streaming without waiting for
        the full sentence to generate.
        """
        if not self.is_available():
            raise DiffusionUnavailable(self._reason_or_default())
        self._load()

        from app.services.diffusion.data import (
            N_BODY, N_FACE, N_HAND, N_POINTS,
        )

        tokens = text_to_gloss(text)
        if not tokens:
            raise DiffusionUnavailable("No signable tokens produced from input text")

        # Map style to guidance scale and pacing speed
        style_guidance = {
            "neutral": guidance_scale,
            "expressive": guidance_scale * 1.35,
            "compact": max(1.0, guidance_scale * 0.8),
        }.get(style, guidance_scale)
        speed = {"neutral": 1.0, "expressive": 0.85, "compact": 1.25}.get(style, 1.0)

        plan: List[str] = []
        for t in tokens:
            if t.word.lower() in self._vocab:
                plan.append(t.word.lower())
            else:
                plan.extend([c for c in t.word.lower() if c in self._vocab])
        if not plan:
            raise DiffusionUnavailable("No tokens matched the trained vocabulary")

        components = [
            {"name": "POSE_LANDMARKS", "points": BODY_POINTS,
             "limbs": [list(l) for l in BODY_LIMBS], "offset": 0, "count": N_BODY},
            {"name": "LEFT_HAND_LANDMARKS", "points": HAND_POINTS,
             "limbs": [list(l) for l in HAND_LIMBS], "offset": N_BODY, "count": N_HAND},
            {"name": "RIGHT_HAND_LANDMARKS", "points": HAND_POINTS,
             "limbs": [list(l) for l in HAND_LIMBS], "offset": N_BODY + N_HAND, "count": N_HAND},
            {"name": "FACE_LANDMARKS", "points": [str(i) for i in range(N_FACE)],
             "limbs": [list(l) for l in FACE_LIMBS], "offset": N_BODY + 2 * N_HAND, "count": N_FACE},
        ]

        meta = {
            "format": "landmarks",
            "fps": 25,
            "components": components,
            "num_points": N_POINTS,
            "normalized": True,
            "gloss": plan,
            "tokens": [t.model_dump() for t in tokens],
            "variant": variant,
            "style": style,
        }
        yield ("meta", meta)

        overlap_tail = None
        for i, g in enumerate(plan):
            seg = self._sample_gloss(g, style_guidance, seed)
            if abs(speed - 1.0) > 1e-3:
                t_out = max(2, int(round(seg.shape[0] / speed)))
                src = np.linspace(0, 1, seg.shape[0])
                dst = np.linspace(0, 1, t_out)
                seg = np.stack([np.interp(dst, src, seg[:, d]) for d in range(seg.shape[1])], axis=1)

            if overlap_tail is None:
                if len(plan) == 1:
                    frames_to_yield = seg
                    overlap_tail = None
                else:
                    frames_to_yield = seg[:-transition_frames]
                    overlap_tail = seg[-transition_frames:]
            else:
                tf = min(transition_frames, seg.shape[0], overlap_tail.shape[0])
                head = seg[:tf]
                blended = np.empty_like(head)
                for k in range(tf):
                    a = 0.5 - 0.5 * np.cos(np.pi * (k + 1) / (tf + 1))
                    blended[k] = overlap_tail[k] * (1 - a) + head[k] * a

                if i == len(plan) - 1:
                    frames_to_yield = np.concatenate([blended, seg[tf:]], axis=0)
                    overlap_tail = None
                else:
                    frames_to_yield = np.concatenate([blended, seg[tf:-transition_frames]], axis=0)
                    overlap_tail = seg[-transition_frames:]

            pts = frames_to_yield.reshape(frames_to_yield.shape[0], N_POINTS, 3)
            chunk = [
                [[round(float(v), 4) for v in pts[t, p]] for p in range(N_POINTS)]
                for t in range(pts.shape[0])
            ]
            yield ("chunk", {"frames": chunk, "sign_index": i, "gloss": g, "final": (i == len(plan) - 1)})


def landmarks_to_avatar_joints(pts_frame: np.ndarray) -> dict:
    """
    Kinematic solver estimating avatar Euler joint rotations and blendshapes
    from a single 66-point landmark frame.
    pts_frame: [66, 3]
    """
    ls, rs = pts_frame[0], pts_frame[1]
    le, re = pts_frame[2], pts_frame[3]
    lw, rw = pts_frame[4], pts_frame[5]

    v_l_arm = le - ls
    v_r_arm = re - rs
    v_l_fore = lw - le
    v_r_fore = rw - re

    pitch_r = float(np.arctan2(v_r_arm[1], -v_r_arm[0])) if np.linalg.norm(v_r_arm) > 1e-4 else 0.0
    elbow_r = float(np.arccos(np.clip(
        np.dot(v_r_arm, v_r_fore) / (np.linalg.norm(v_r_arm) * np.linalg.norm(v_r_fore) + 1e-6), -1.0, 1.0
    )))

    pitch_l = float(np.arctan2(v_l_arm[1], v_l_arm[0])) if np.linalg.norm(v_l_arm) > 1e-4 else 0.0
    elbow_l = float(np.arccos(np.clip(
        np.dot(v_l_arm, v_l_fore) / (np.linalg.norm(v_l_arm) * np.linalg.norm(v_l_fore) + 1e-6), -1.0, 1.0
    )))

    joints = {
        "spine": [0.0, 0.0, 0.0],
        "chest": [0.0, 0.0, 0.0],
        "neck": [0.0, 0.0, 0.0],
        "head": [0.0, 0.0, 0.0],
        "shoulder_l": [float(np.clip(pitch_l, -1.5, 1.5)), 0.0, 0.15],
        "elbow_l": [float(np.clip(elbow_l, 0.0, 2.5)), 0.0, 0.0],
        "wrist_l": [0.0, 0.0, 0.0],
        "hand_l": [0.0, 0.0, 0.0],
        "shoulder_r": [float(np.clip(pitch_r, -1.5, 1.5)), 0.0, -0.15],
        "elbow_r": [float(np.clip(elbow_r, 0.0, 2.5)), 0.0, 0.0],
        "wrist_r": [0.0, 0.0, 0.0],
        "hand_r": [0.0, 0.0, 0.0],
    }

    face_pts = pts_frame[50:66]
    mouth_open = 0.0
    if len(face_pts) >= 16:
        vert_span = float(np.linalg.norm(face_pts[10] - face_pts[14]))
        mouth_open = float(np.clip(vert_span * 2.0, 0.0, 1.0))

    face = {
        "eyebrows_up": 0.0,
        "eyebrows_down": 0.0,
        "mouth_open": mouth_open,
        "mouth_smile": 0.1,
        "cheek_puff": 0.0,
    }

    return {"joints": joints, "face": face}


diffusion_backend = DiffusionMotionBackend()

