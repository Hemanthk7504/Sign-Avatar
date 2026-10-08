"""
Gloss -> Motion generation.

=====================================================================
IMPORTANT — architecture note (read before swapping in a trained model)
=====================================================================
The paper's proposed architecture is a diffusion model over continuous pose
trajectories, trained on paired (gloss, motion-capture) data. No such motion
-capture corpus or trained checkpoint is available in this environment, so
`DiffusionMotionModel` below is a **procedural stand-in that implements the
exact same call signature** a trained model would:

    generate(gloss_tokens, variant, style, seed) -> List[Pose]

Internally it still runs a genuine iterative denoising loop (start from a
noisy pose, refine over `DIFFUSION_STEPS` steps toward a keyframe target,
governed by a variance schedule) so the sampling *mechanics* — stochastic
style variation, iterative refinement, guidance toward a target — mirror a
real diffusion sampler. What's missing is the learned score/noise-prediction
network; here the "denoiser" is a closed-form pull toward hand-authored
keyframes instead of a network's learned gradient. To go from this to the
paper's system:
    1. Replace `_denoise_step()` with a call to a trained noise-prediction
       network (e.g. a transformer conditioned on gloss embeddings + timestep).
    2. Replace `SIGN_DICTIONARY` lookups with a learned gloss/text embedding
       fed as conditioning to that network instead of literal keyframes.
    3. Everything else — coarticulation blending, non-manual channel timing,
       FPS/streaming — is architecture-agnostic and can stay as-is.
=====================================================================
"""
from __future__ import annotations

import math
import random
from typing import Dict, List, Optional

import numpy as np

from app.config import settings
from app.schemas import GlossToken, Pose
from app.services import gloss_dictionary as gd

STYLE_PROFILES = {
    # multiplies motion amplitude / speed / hold-time to approximate personal
    # signing style, per the paper's style-conditioning requirement
    "neutral":    {"amp": 1.00, "speed": 1.00, "hold": 1.00},
    "expressive": {"amp": 1.35, "speed": 0.90, "hold": 1.15},
    "compact":    {"amp": 0.70, "speed": 1.25, "hold": 0.80},
}


def _add(a: List[float], b: List[float], w: float = 1.0) -> List[float]:
    return [a[i] + b[i] * w for i in range(3)]


def _lerp(a: List[float], b: List[float], t: float) -> List[float]:
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


def _ease_in_out(t: float) -> float:
    return 0.5 - 0.5 * math.cos(math.pi * t)


class DiffusionMotionModel:
    """Procedural, interface-compatible stand-in for a trained diffusion
    motion-synthesis model (see module docstring)."""

    def __init__(self, steps: int = settings.DIFFUSION_STEPS, noise_scale: float = settings.NOISE_SCALE):
        self.steps = steps
        self.noise_scale = noise_scale

    # -- "denoising" sampler --------------------------------------------------
    def _denoise_step(self, current: Dict[str, List[float]], target: Dict[str, List[float]],
                       step: int, rng: random.Random) -> Dict[str, List[float]]:
        """
        One step of an iterative refinement process that pulls a noisy pose
        toward the target keyframe, following a cosine variance schedule
        (mirrors the alpha/beta schedules used in real diffusion samplers).
        A stand-in for a learned score/noise-prediction network.
        """
        progress = (step + 1) / self.steps
        pull = _ease_in_out(progress)          # how strongly we snap to target this step
        residual_noise = self.noise_scale * (1.0 - progress)  # noise shrinks as we denoise

        out = {}
        for joint, tgt in target.items():
            cur = current.get(joint, tgt)
            blended = _lerp(cur, tgt, pull)
            noise = [rng.uniform(-residual_noise, residual_noise) for _ in range(3)]
            out[joint] = _add(blended, noise)
        return out

    def sample_keyframe(self, target_pose: Dict[str, List[float]], seed: int) -> Dict[str, List[float]]:
        """Run the full iterative refinement loop to sample one stylized
        keyframe from noise, conditioned on a target sign pose."""
        rng = random.Random(seed)
        current = {j: [rng.uniform(-1, 1) * self.noise_scale * 3 for _ in range(3)] for j in gd.JOINTS}
        for step in range(self.steps):
            current = self._denoise_step(current, target_pose, step, rng)
        return current

    # -- full sequence generation ---------------------------------------------
    def generate(
        self,
        gloss_tokens: List[GlossToken],
        variant: str = "ASL",
        style: str = "neutral",
        seed: Optional[int] = None,
    ) -> List[Pose]:
        if not gloss_tokens:
            return []

        style_cfg = STYLE_PROFILES.get(style, STYLE_PROFILES["neutral"])
        base_seed = seed if seed is not None else 42
        fps = settings.TARGET_FPS
        dt = 1.0 / fps

        hold_frames = max(1, round(settings.SIGN_HOLD_FRAMES * style_cfg["hold"] / style_cfg["speed"]))
        trans_frames = max(1, round(settings.TRANSITION_FRAMES / style_cfg["speed"]))

        # Resolve each gloss token to one or more (pose, face, non_manual) entries,
        # expanding out-of-vocabulary words into fingerspelled letter sequences.
        expanded: List[Dict] = []
        for tok in gloss_tokens:
            entry = gd.lookup_sign(tok.word)
            if entry is not None:
                expanded.append({
                    "pose": entry["pose"],
                    "face": entry["face"],
                    "non_manual": tok.non_manual,
                    "label": tok.gloss,
                })
            else:
                letters = gd.fingerspell(tok.word)
                for i, letter_entry in enumerate(letters):
                    expanded.append({
                        "pose": letter_entry["pose"],
                        "face": {},
                        "non_manual": tok.non_manual if i == len(letters) - 1 else [],
                        "label": f"#{tok.word.upper()}",
                    })

        if not expanded:
            return []

        frames: List[Pose] = []
        t = 0.0
        prev_pose = dict(gd.REST_POSE)
        prev_face = dict(gd.REST_FACE)

        for idx, item in enumerate(expanded):
            target_pose_raw = item["pose"]
            # Style amplitude scaling relative to rest pose
            target_pose = {
                j: _lerp(gd.REST_POSE[j], v, style_cfg["amp"]) if j in gd.REST_POSE else v
                for j, v in target_pose_raw.items()
            }
            # Sample a stylized keyframe via the (procedural) diffusion sampler
            sign_seed = base_seed + idx * 97
            sampled_pose = self.sample_keyframe(target_pose, sign_seed)

            target_face = dict(gd.REST_FACE)
            target_face.update(item["face"])
            for marker in item["non_manual"]:
                target_face.update(_non_manual_to_blendshapes(marker))

            # --- transition into this sign (coarticulation) ---
            for f in range(trans_frames):
                tt = _ease_in_out((f + 1) / trans_frames)
                pose_frame = {j: _lerp(prev_pose[j], sampled_pose[j], tt) for j in gd.JOINTS}
                # Non-manual features are blended on a slightly different
                # timing curve than manual signs — grammatical facial marking
                # in real sign languages spreads earlier/later than the
                # manual sign it scopes over.
                face_tt = _ease_in_out(min(1.0, (f + 1) / trans_frames + settings.COARTICULATION_BLEND))
                face_frame = {k: prev_face[k] + (target_face[k] - prev_face[k]) * face_tt for k in gd.REST_FACE}
                frames.append(Pose(t=round(t, 4), joints=pose_frame, face=face_frame))
                t += dt

            # --- hold at peak pose (with tiny residual jitter for naturalism) ---
            hold_rng = random.Random(sign_seed + 1)
            for _ in range(hold_frames):
                jitter = {
                    j: _add(sampled_pose[j], [hold_rng.uniform(-0.01, 0.01) for _ in range(3)])
                    for j in gd.JOINTS
                }
                frames.append(Pose(t=round(t, 4), joints=jitter, face=dict(target_face)))
                t += dt

            prev_pose = sampled_pose
            prev_face = target_face

        # --- return to rest ---
        for f in range(trans_frames):
            tt = _ease_in_out((f + 1) / trans_frames)
            pose_frame = {j: _lerp(prev_pose[j], gd.REST_POSE[j], tt) for j in gd.JOINTS}
            face_frame = {k: prev_face[k] + (gd.REST_FACE[k] - prev_face[k]) * tt for k in gd.REST_FACE}
            frames.append(Pose(t=round(t, 4), joints=pose_frame, face=face_frame))
            t += dt

        return frames


def _non_manual_to_blendshapes(marker: str) -> Dict[str, float]:
    mapping = {
        "raised_eyebrows": {"eyebrows_up": 0.7},
        "furrowed_brow": {"eyebrows_down": 0.7},
        "head_shake": {},          # handled as root/head rotation, not a blendshape
        "head_forward": {},
        "head_tilt": {},
    }
    return mapping.get(marker, {})


# Singleton used by the pipeline / API layer.
motion_model = DiffusionMotionModel()
