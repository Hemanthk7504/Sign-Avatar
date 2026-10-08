"""
Adapter for **SignSparK** (Low et al., ECCV 2026, CVSSP University of Surrey) —
a real, pretrained, open-source Conditional Flow Matching model for 3D Sign
Language Production, trained on CSL-Daily / How2Sign / BOBSL SMPL-X motion.

    Paper:  https://arxiv.org/abs/2603.10446
    Code:   https://github.com/JianHe0628/SignSparK
    Models: https://huggingface.co/LionelLow/SignSparK   (hand/body/face EMA checkpoints)
    Data:   https://huggingface.co/datasets/LionelLow/SignSparK_data

=====================================================================
IMPORTANT — what this file is and isn't
=====================================================================
This is a real, from-source-reading-accurate integration: the conditioning
dict construction, keyframe-masking, and per-stream sampling calls below
follow SignSparK's actual `sample.py` / `signspark/rflow.py` / `basic_utils.py`
exactly (see the code comments citing the relevant file/line behavior).

What it does NOT include, because they are outside what a text-generation
service can responsibly ship or what this environment can run:
  - The pretrained checkpoints themselves (~1.4B params x 3 streams). You
    must download them yourself (see `setup_signspark.sh` / README) — this
    sandbox has no network access to Hugging Face and no GPU, so the actual
    weight download and inference were **not executed or verified end-to-end
    here**. The conditioning/sampling code below was written by reading
    SignSparK's source directly, not by running it.
  - SignSparK's "FAST" keyframe segmenter, which is embargoed by its authors
    until end of September 2026. Without it, arbitrary new sentences can only
    be generated in SignSparK's *fully unconditional* (text-only, no
    keyframe) mode (`keyframes_mask_all=True` + classifier-free text
    guidance) — which is what this adapter uses. This means outputs are less
    constrained/anchored than the paper's headline (keyframe-conditioned)
    results.
  - Full-fidelity face and per-finger hand rendering. SMPL-X face expression
    output is a 50-dim FLAME blendshape vector with no public name mapping
    used here, so this adapter only extracts jaw rotation for mouth
    articulation; hand output is 15 MANO joints per hand, compressed into
    this codebase's existing 2-DOF (curl/spread) hand proxy. Both are
    documented extension points below.
  - Language/variant coverage is whatever the released checkpoints were
    trained on: How2Sign = ASL/English, BOBSL = BSL/English. CSL-Daily is
    Chinese Sign Language (not one of this project's configured variants).
    ISL is not covered by any released checkpoint.

If any of the above isn't set up, `SignSparkMotionModel` raises
`SignSparkUnavailable` with a specific reason, and `pipeline.py` falls back
to the procedural `DiffusionMotionModel` automatically — the app always
runs, and only uses the real trained model when it's genuinely available.
=====================================================================
"""
from __future__ import annotations

import os
import sys
import logging
from dataclasses import dataclass
from typing import Dict, List, Optional

from app.config import settings
from app.schemas import GlossToken, Pose
from app.services import gloss_dictionary as gd

logger = logging.getLogger("sign_avatar.signspark")

# --- Repo / checkpoint locations (override via environment) -----------------
SIGNSPARK_REPO_DIR = os.environ.get("SIGNSPARK_REPO_DIR", "")
SIGNSPARK_CKPT_DIR = os.environ.get("SIGNSPARK_CKPT_DIR", "./checkpoints")

# --- Model constants, taken directly from the SignSparK source --------------
# basic_utils.py: unet_init() -> n_joints per stream
STREAM_NJOINTS = {"hand": 90, "body": 60, "face": 56}
NUM_HAND_JOINTS = 15         # MANO joints/hand (tools/visualize.py: NUM_HAND_JOINTS)
NUM_LEG_SPINE_JOINTS = 11    # unpredicted leading body joints (tools/visualize.py)
SEQ_LEN = 304                # configs/data_v2/common/inference.yaml: seq_len
NATIVE_FPS = 20              # assumption: matches tools/visualize.py's default --fps;
                             # not documented explicitly in the repo — verify against
                             # your own samples if exact timing matters.

# SMPL-X body_pose joint order, indices 11-20 (the 10 joints the body stream
# predicts; the leading 11 leg/spine joints are zeroed — see
# tools/visualize.py:build_smplx_input, NUM_LEG_SPINE_JOINTS).
BODY_PREDICTED_JOINTS = [
    "neck", "left_collar", "right_collar", "head",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist",
]

# Maps SMPL-X body joint names -> this project's avatar joint names
# (app/services/gloss_dictionary.JOINTS). "collar" has no dedicated avatar
# pivot, so it's folded additively into the corresponding shoulder rotation.
SMPLX_TO_AVATAR_JOINT = {
    "neck": "neck",
    "head": "head",
    "left_shoulder": "shoulder_l",
    "right_shoulder": "shoulder_r",
    "left_elbow": "elbow_l",
    "right_elbow": "elbow_r",
    "left_wrist": "wrist_l",
    "right_wrist": "wrist_r",
}

# variant -> (language tag used for `specify_lang` text prefixing, dataset the
# checkpoint saw that language on). ISL has no released checkpoint coverage.
VARIANT_LANGUAGE = {
    "ASL": "en",   # How2Sign
    "BSL": "en",   # BOBSL
}


class SignSparkUnavailable(RuntimeError):
    """Raised whenever the real pretrained model can't be used right now —
    the caller (pipeline.py) should catch this and fall back to the
    procedural DiffusionMotionModel."""


def _require(condition: bool, reason: str):
    if not condition:
        raise SignSparkUnavailable(reason)


@dataclass
class _StreamHandle:
    model: "object"
    flow: "object"
    device: "object"


class SignSparkMotionModel:
    """
    Wraps the pretrained SignSparK flow-matching model behind the same
    generate() shape used elsewhere in this codebase, but keyed on raw text
    (SignSparK conditions on spoken-language text directly — there is no
    separate gloss stage in its architecture, unlike this project's default
    text_to_gloss -> keyframe-dictionary pipeline).
    """

    def __init__(self):
        self._streams: Dict[str, _StreamHandle] = {}
        self._checked = False
        self._available = False
        self._reason = ""

    # -- availability -----------------------------------------------------
    def is_available(self) -> bool:
        if self._checked:
            return self._available
        self._checked = True
        try:
            self._check_prereqs()
            self._available = True
        except SignSparkUnavailable as exc:
            self._available = False
            self._reason = str(exc)
            logger.warning("SignSparK backend unavailable: %s", self._reason)
        return self._available

    def _check_prereqs(self):
        _require(bool(SIGNSPARK_REPO_DIR), "SIGNSPARK_REPO_DIR is not set")
        _require(os.path.isdir(SIGNSPARK_REPO_DIR), f"SIGNSPARK_REPO_DIR '{SIGNSPARK_REPO_DIR}' does not exist")
        try:
            import torch  # noqa: F401
        except ImportError as exc:
            raise SignSparkUnavailable(f"PyTorch not installed: {exc}") from exc
        for stream in ("hand", "body", "face"):
            ckpt = os.path.join(SIGNSPARK_CKPT_DIR, stream, "ema_0.9999_200000.pt")
            _require(os.path.isfile(ckpt), f"Missing checkpoint: {ckpt} (run tools/download_models.py)")

    def _reason_or_default(self) -> str:
        return self._reason or "SignSparK prerequisites not satisfied"

    # -- model loading ------------------------------------------------------
    def _load_stream(self, stream: str) -> _StreamHandle:
        if stream in self._streams:
            return self._streams[stream]

        if SIGNSPARK_REPO_DIR not in sys.path:
            sys.path.insert(0, SIGNSPARK_REPO_DIR)

        import torch
        from basic_utils import create_model_and_flow  # from the SignSparK repo

        # Mirrors configs/data_v2/common/inference.yaml merged with
        # configs/data_v2/<stream>.yaml, without requiring Hydra at runtime.
        cfg = dict(
            hidden_t_dim=512,
            hidden_dim=512,
            dropout=0.1,
            model_arch="unet_large",
            final_type=2,
            unet_out_mult=8,
            seq_len=SEQ_LEN,
            dataset_feat=stream,
            text_conditioned=True,
            text_mask_prob=0.1,
            text_enc_name="CLIP",
            text_enc_dim=640,
            text_enc_ver="M-CLIP/XLM-Roberta-Large-Vit-B-16Plus",
            length_mask_conditioned=True,
            keyframe_conditioned=True,
        )
        model, _flow = create_model_and_flow(**cfg)

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        ckpt_path = os.path.join(SIGNSPARK_CKPT_DIR, stream, "ema_0.9999_200000.pt")
        state_dict = torch.load(ckpt_path, map_location="cpu")
        model.load_state_dict(state_dict, strict=True)
        model.eval().requires_grad_(False).to(device)

        handle = _StreamHandle(model=model, flow=_flow, device=device)
        self._streams[stream] = handle
        return handle

    # -- sampling -------------------------------------------------------------
    def _sample_stream(self, stream: str, text: str, ode_stepnum: int, guidance_scale: float, seed: int):
        """Runs SignSparK's fully-unconditional (text-only) sampling path for
        one body stream, mirroring sample.py's inner loop with
        keyframes_mask_all=True (see sample.py lines building `cond['obs_mask']`
        and RFlow.decode, signspark/rflow.py)."""
        import torch
        from classifier_free import ClassifierFreeSampleModel  # from SignSparK repo

        torch.manual_seed(seed)
        handle = self._load_stream(stream)
        n_joints = STREAM_NJOINTS[stream]
        device = handle.device

        model = handle.model
        if guidance_scale and guidance_scale > 0:
            model = ClassifierFreeSampleModel(model, text_scale=torch.tensor(guidance_scale, device=device))

        cond = {
            "y": {
                "text": [text],
                "mask": torch.ones(1, 1, SEQ_LEN, dtype=torch.bool, device=device),
                "lengths": torch.tensor([SEQ_LEN]),
                "keyframes": [[]],
                "video_names": ["live_request"],
            },
        }
        # x_embed's actual values don't matter here: with obs_mask all False,
        # RFlow.decode computes `x_embed * mask + noise * (~mask)` == pure
        # noise (see signspark/rflow.py:decode). Only the shape matters.
        cond["obs_x0"] = torch.zeros(1, n_joints, SEQ_LEN, device=device)
        cond["obs_mask"] = torch.zeros(1, n_joints, SEQ_LEN, dtype=torch.bool, device=device)
        noise = torch.randn(1, n_joints, SEQ_LEN, device=device)

        samples, _nfe = handle.flow.decode(
            model,
            noise=noise,
            keyframe_mask=cond["obs_mask"],
            x_embed=cond["obs_x0"],
            model_kwargs=cond,
            ode_package="torchdiffeq",
            ode_stepnum=ode_stepnum,
        )
        return samples.squeeze(0).detach().cpu().numpy()  # [n_joints, SEQ_LEN]

    # -- rotation conversion (Zhou et al. 6D -> matrix -> axis-angle) --------
    @staticmethod
    def _rot6d_to_euler_xyz(d6):
        """(...,6) 6D rotation -> (...,3) intrinsic XYZ Euler angles (radians).
        Gram-Schmidt formula matches SignSparK's tools/visualize.py
        `rot6d_to_matrix` exactly; converted to Euler via scipy for direct use
        as this project's avatar joint rotations."""
        import numpy as np
        from scipy.spatial.transform import Rotation

        d6 = np.asarray(d6, dtype=np.float64)
        a1, a2 = d6[..., :3], d6[..., 3:]
        b1 = a1 / (np.linalg.norm(a1, axis=-1, keepdims=True) + 1e-8)
        a2_proj = a2 - (np.sum(b1 * a2, axis=-1, keepdims=True)) * b1
        b2 = a2_proj / (np.linalg.norm(a2_proj, axis=-1, keepdims=True) + 1e-8)
        b3 = np.cross(b1, b2)
        mats = np.stack([b1, b2, b3], axis=-2)  # (...,3,3)
        flat = mats.reshape(-1, 3, 3)
        euler = Rotation.from_matrix(flat).as_euler("xyz")
        return euler.reshape(*d6.shape[:-1], 3)

    def _body_stream_to_avatar_joints(self, body_60d) -> List[Dict[str, List[float]]]:
        """body_60d: [T, 60] (10 joints x 6D) -> per-frame avatar joint dict."""
        import numpy as np
        t = body_60d.shape[0]
        d6 = body_60d.reshape(t, 10, 6)
        euler = self._rot6d_to_euler_xyz(d6)  # [T, 10, 3]

        frames = []
        for f in range(t):
            joints = {j: [0.0, 0.0, 0.0] for j in gd.JOINTS}
            collar_l = collar_r = None
            for i, name in enumerate(BODY_PREDICTED_JOINTS):
                vec = euler[f, i].tolist()
                if name == "left_collar":
                    collar_l = vec
                    continue
                if name == "right_collar":
                    collar_r = vec
                    continue
                avatar_name = SMPLX_TO_AVATAR_JOINT.get(name)
                if avatar_name:
                    joints[avatar_name] = vec
            # Fold collar rotation additively into shoulder (no dedicated pivot).
            if collar_l:
                joints["shoulder_l"] = [joints["shoulder_l"][k] + collar_l[k] for k in range(3)]
            if collar_r:
                joints["shoulder_r"] = [joints["shoulder_r"][k] + collar_r[k] for k in range(3)]
            frames.append(joints)
        return frames

    def _hand_stream_to_curl_spread(self, hand_90d) -> List[List[float]]:
        """hand_90d: [T, 90] (15 MANO joints x 6D, right-hand frame) -> per
        -frame [curl, spread, twist] proxy compatible with this project's
        2-DOF hand_l/hand_r joint. This is a lossy compression of full
        per-finger articulation — extending the avatar rig to real 15-joint
        hands is the natural next step if finger-level detail is needed."""
        import numpy as np
        t = hand_90d.shape[0]
        d6 = hand_90d.reshape(t, NUM_HAND_JOINTS, 6)
        euler = self._rot6d_to_euler_xyz(d6)  # [T, 15, 3]
        curl = euler[:, :, 0].mean(axis=1)      # mean flexion across fingers
        spread = euler[:, :, 1].mean(axis=1)    # mean abduction
        return [[float(curl[f]), float(spread[f]), 0.0] for f in range(t)]

    @staticmethod
    def _flip_left_hand(hand_90d):
        """Conjugate a right-hand-frame sample into left-hand frame:
        R_FLIP @ M @ R_FLIP with R_FLIP = diag(1,-1,-1) (tools/visualize.py:
        flip_left_hand_6d) — applied here in 6D space by flipping the sign
        convention on the relevant axis components before Euler conversion.
        Approximate: negates the y/z-influenced 6D components consistently
        with the same diagonal conjugation used upstream."""
        import numpy as np
        d6 = hand_90d.reshape(-1, NUM_HAND_JOINTS, 6).copy()
        d6[..., [1, 2, 4, 5]] *= -1  # flip y,z components of both 3-vectors
        return d6.reshape(hand_90d.shape)

    def _face_stream_to_blendshapes(self, face_56d) -> List[Dict[str, float]]:
        """face_56d: [T, 56] = jaw 6D (6) + FLAME expression (50). Only jaw
        rotation is mapped (to mouth_open); the 50-dim expression basis has no
        public name mapping used here, so eyebrow/smile blendshapes are left
        at rest. Wiring a FLAME decoder is the natural extension point for
        full facial fidelity."""
        t = face_56d.shape[0]
        jaw6 = face_56d[:, :6].reshape(t, 1, 6)
        euler = self._rot6d_to_euler_xyz(jaw6)[:, 0, :]  # [T,3]
        out = []
        for f in range(t):
            mouth_open = max(0.0, min(1.0, abs(float(euler[f, 0])) / 0.5))
            out.append({"eyebrows_up": 0.0, "eyebrows_down": 0.0, "mouth_open": mouth_open, "mouth_smile": 0.1, "cheek_puff": 0.0})
        return out

    # -- public interface -----------------------------------------------------
    def generate(
        self,
        text: str,
        gloss_tokens: Optional[List[GlossToken]] = None,
        variant: str = settings.DEFAULT_VARIANT,
        style: str = "neutral",
        seed: Optional[int] = None,
        ode_stepnum: int = 50,
        text_guidance_scale: float = 2.5,
    ) -> List[Pose]:
        if not self.is_available():
            raise SignSparkUnavailable(self._reason_or_default())

        language = VARIANT_LANGUAGE.get(variant)
        _require(language is not None, f"Variant '{variant}' has no released SignSparK checkpoint coverage")

        prefixed_text = f"{language} {text}".strip()
        base_seed = seed if seed is not None else 42

        body = self._sample_stream("body", prefixed_text, ode_stepnum, text_guidance_scale, base_seed)
        right_hand = self._sample_stream("hand", prefixed_text, ode_stepnum, text_guidance_scale, base_seed + 1)
        left_hand_raw = self._sample_stream("hand", prefixed_text, ode_stepnum, text_guidance_scale, base_seed + 2)
        left_hand = self._flip_left_hand(left_hand_raw.T).T  # operate in [T,90] orientation
        face = self._sample_stream("face", prefixed_text, ode_stepnum, text_guidance_scale, base_seed + 3)

        body_joints = self._body_stream_to_avatar_joints(body.T)          # [T,60] -> per-frame dict
        right_curl = self._hand_stream_to_curl_spread(right_hand.T)       # [T,90] -> [T,3]
        left_curl = self._hand_stream_to_curl_spread(left_hand.T)
        face_frames = self._face_stream_to_blendshapes(face.T)

        frames: List[Pose] = []
        dt_native = 1.0 / NATIVE_FPS
        for f in range(SEQ_LEN):
            joints = body_joints[f]
            joints["hand_l"] = left_curl[f]
            joints["hand_r"] = right_curl[f]
            frames.append(Pose(t=round(f * dt_native, 4), joints=joints, face=face_frames[f]))

        return _resample_to_fps(frames, NATIVE_FPS, settings.TARGET_FPS)


def _resample_to_fps(frames: List[Pose], src_fps: int, dst_fps: int) -> List[Pose]:
    """Linear-interpolate a fixed-length pose sequence from src_fps to
    dst_fps. Simple per-axis lerp on Euler angles — fine for the small
    inter-frame deltas typical of signing motion, not a substitute for
    quaternion slerp if very large per-frame rotations occur."""
    if src_fps == dst_fps or not frames:
        return frames
    duration = frames[-1].t
    n_out = max(1, round(duration * dst_fps) + 1)
    out = []
    for i in range(n_out):
        t = i / dst_fps
        # Find surrounding source frames
        idx = min(int(t / (1.0 / src_fps)), len(frames) - 2) if len(frames) > 1 else 0
        f0, f1 = frames[idx], frames[min(idx + 1, len(frames) - 1)]
        span = max(f1.t - f0.t, 1e-6)
        alpha = max(0.0, min(1.0, (t - f0.t) / span))
        joints = {
            j: [f0.joints[j][k] + (f1.joints[j][k] - f0.joints[j][k]) * alpha for k in range(3)]
            for j in f0.joints
        }
        face = {k: f0.face[k] + (f1.face[k] - f0.face[k]) * alpha for k in f0.face}
        out.append(Pose(t=round(t, 4), joints=joints, face=face))
    return out


# Singleton, mirroring motion_generator.motion_model's usage pattern.
signspark_model = SignSparkMotionModel()
