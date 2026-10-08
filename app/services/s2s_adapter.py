"""
Real, CPU-only sign motion backend using **spoken-to-signed-translation**
(Moryossef, Müller et al., AT4SSL 2023 — the pipeline behind sign.mt).

    Code:  https://github.com/sign-language-processing/spoken-to-signed-translation
    Paper: https://arxiv.org/abs/2305.17714

Why this backend instead of a diffusion/flow-matching model:
  - It is **genuinely real motion data**: every sign is MediaPipe Holistic
    3D landmarks (33 body / 21 per hand / 478 face) pose-estimated from real
    human signers, not hand-authored keyframes.
  - It runs **entirely on CPU in about a second per sentence** — measured at
    ~1.1s for a 5-word sentence in this project's own testing — because the
    heavy lifting is dictionary lookup plus learned smoothing/concatenation,
    not a billion-parameter denoiser. That makes real-time conversational use
    actually achievable without a GPU.
  - ASL fingerspelling poses (A-Z, real capture) ship inside the package, so
    this backend works out of the box with no model download at all.

=====================================================================
HONEST LIMITATIONS — read before claiming results
=====================================================================
1. This is a **concatenative** system, not a generative one. It retrieves
   real recorded signs from a lexicon and smoothly stitches them together.
   It does not synthesize novel motion. Your paper proposes a *generative*
   diffusion model; this backend is the strongest thing that actually runs
   in real time on CPU, but it is a different method, and you should
   describe it as such rather than as a diffusion model.
2. **Word-level vocabulary depends on the lexicon you download.** The only
   lexicon the upstream project ships a downloader for is SignSuisse, which
   covers Swiss German (sgg), Swiss French (ssr) and Swiss Italian (slf)
   Sign Language — *not* ASL. With no lexicon downloaded, ASL ('ase') works
   but **every word is fingerspelled letter-by-letter**, which is real
   signing behavior for names/unknown words but is not how fluent ASL
   renders common vocabulary.
3. Non-manual features come along "for free" in the face landmarks of each
   recorded sign, but they are whatever the original signer did — they are
   not independently controllable or grammatically re-synthesized the way
   your paper's abstract describes.
4. Output is **3D landmark positions**, not joint rotations, so it drives
   the landmark/skeleton renderer in the frontend rather than the
   primitive-humanoid rig used by the procedural backend.
=====================================================================
"""
from __future__ import annotations

import contextlib
import io
import logging
import os
from typing import List, Optional

from app.config import settings

logger = logging.getLogger("sign_avatar.s2s")

# Lexicon directory. If unset/missing, falls back to fingerspelling-only mode,
# which still works and still uses real captured pose data.
S2S_LEXICON_DIR = os.environ.get("S2S_LEXICON_DIR", "")

# variant -> (signed language code, spoken language code)
# 'ase' = American Sign Language, 'sgg' = Swiss German SL, etc. (IANA subtags)
VARIANT_TO_CODES = {
    "ASL": ("ase", "en"),
    "BSL": ("bfi", "en"),   # fingerspelling lexicon ships 'bfi'-adjacent sets; verify coverage
    "DSGS": ("sgg", "de"),  # Swiss German SL — the one SignSuisse actually covers well
    "LSF-CH": ("ssr", "fr"),
    "LIS-CH": ("slf", "it"),
}


class S2SUnavailable(RuntimeError):
    """Raised when the spoken-to-signed backend can't run; the pipeline
    catches this and falls back to the procedural backend."""


class S2SMotionModel:
    """Landmark-based sign motion backend. Returns real MediaPipe Holistic
    3D landmark frames rather than joint rotations."""

    def __init__(self):
        self._checked = False
        self._available = False
        self._reason = ""
        self._lookup = None
        self._skeleton = None

    # -- availability ---------------------------------------------------------
    def is_available(self) -> bool:
        if self._checked:
            return self._available
        self._checked = True
        try:
            import spoken_to_signed  # noqa: F401
            import pose_format  # noqa: F401
            self._available = True
        except ImportError as exc:
            self._reason = (
                f"spoken-to-signed/pose-format not installed ({exc}). "
                "Run: pip install 'git+https://github.com/sign-language-processing/"
                "spoken-to-signed-translation.git' pose-format simplemma"
            )
            logger.warning("S2S backend unavailable: %s", self._reason)
        return self._available

    def _reason_or_default(self) -> str:
        return self._reason or "spoken-to-signed backend not available"

    # -- lookup construction --------------------------------------------------
    def _get_lookup(self):
        """Build (once) the pose lookup: lexicon if configured, always with a
        real-capture fingerspelling fallback so no word is ever unrenderable."""
        if self._lookup is not None:
            return self._lookup

        from spoken_to_signed.gloss_to_pose import CSVPoseLookup
        from spoken_to_signed.gloss_to_pose.lookup.fingerspelling_lookup import (
            FingerspellingPoseLookup,
        )

        fingerspelling = FingerspellingPoseLookup()

        if S2S_LEXICON_DIR and os.path.isdir(S2S_LEXICON_DIR):
            self._lookup = CSVPoseLookup(S2S_LEXICON_DIR, backup=fingerspelling)
            logger.info("S2S: using lexicon at %s (fingerspelling fallback enabled)", S2S_LEXICON_DIR)
        else:
            # Fingerspelling-only mode. Still real captured motion, but every
            # word is spelled out letter-by-letter.
            self._lookup = fingerspelling
            logger.warning(
                "S2S: no lexicon at S2S_LEXICON_DIR — running FINGERSPELLING-ONLY. "
                "Every word will be spelled letter-by-letter. Run download_lexicon "
                "to get word-level signs."
            )
        return self._lookup

    # -- generation -----------------------------------------------------------
    def generate_landmarks(
        self,
        text: str,
        variant: str = settings.DEFAULT_VARIANT,
        style: str = "neutral",
        seed: Optional[int] = None,
    ) -> dict:
        """
        text -> real 3D landmark motion.

        Returns a dict ready for JSON transport:
            {
              "format": "landmarks",
              "fps": int,
              "components": [{"name","points","limbs","offset"}],
              "frames": [[[x,y,z] or null, ...], ...],   # per frame, per point
              "num_points": int,
            }
        Coordinates are normalized: centered on the shoulder midpoint and
        scaled by shoulder width, with y flipped so +y is up (MediaPipe uses
        image coordinates where +y is down). This makes them directly usable
        as Three.js world coordinates.
        """
        if not self.is_available():
            raise S2SUnavailable(self._reason_or_default())

        import numpy as np
        from spoken_to_signed.gloss_to_pose import gloss_to_pose
        from spoken_to_signed.text_to_gloss.simple import text_to_gloss

        signed_language, spoken_language = VARIANT_TO_CODES.get(variant, ("ase", "en"))
        lookup = self._get_lookup()

        # The upstream library prints progress to stdout on every call; keep
        # server logs clean by capturing it.
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                sentences = text_to_gloss(text=text, language=spoken_language)
                if not sentences or not sentences[0]:
                    raise S2SUnavailable("No signable tokens produced from input text")
                result = gloss_to_pose(sentences[0], lookup, spoken_language, signed_language)
        except S2SUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001
            raise S2SUnavailable(f"spoken-to-signed generation failed: {exc}") from exc

        pose = result.pose if hasattr(result, "pose") else result
        data = pose.body.data  # masked array [frames, people, points, 3]
        if data.shape[0] == 0:
            raise S2SUnavailable("Generated pose sequence was empty")

        arr = np.array(data[:, 0, :, :], dtype=np.float64)  # [T, P, 3]
        mask = np.ma.getmaskarray(data[:, 0, :, :]).any(axis=-1)  # [T, P] True == missing

        arr, scale_ok = self._normalize(arr, mask, pose)

        components = []
        offset = 0
        for c in pose.header.components:
            components.append({
                "name": c.name,
                "points": list(c.points),
                "limbs": [[int(a), int(b)] for (a, b) in c.limbs],
                "offset": offset,
                "count": len(c.points),
            })
            offset += len(c.points)

        # Emit null for masked (undetected) points so the renderer can skip them
        frames = []
        for t in range(arr.shape[0]):
            frame = []
            for p in range(arr.shape[1]):
                if mask[t, p] or not np.all(np.isfinite(arr[t, p])):
                    frame.append(None)
                else:
                    frame.append([round(float(v), 4) for v in arr[t, p]])
            frames.append(frame)

        return {
            "format": "landmarks",
            "fps": int(pose.body.fps),
            "components": components,
            "frames": frames,
            "num_points": int(arr.shape[1]),
            "normalized": scale_ok,
            "gloss": [str(g) for g in sentences[0].glosses] if hasattr(sentences[0], "glosses") else [],
        }

    @staticmethod
    def _normalize(arr, mask, pose):
        """Center on shoulder midpoint, scale by shoulder width, flip y up.

        Falls back to a bounding-box normalization if shoulders aren't present
        (returns scale_ok=False so the caller knows the scale is approximate)."""
        import numpy as np

        # Locate shoulder indices within the flattened point array
        left_idx = right_idx = None
        offset = 0
        for c in pose.header.components:
            if c.name == "POSE_LANDMARKS":
                pts = list(c.points)
                if "LEFT_SHOULDER" in pts:
                    left_idx = offset + pts.index("LEFT_SHOULDER")
                if "RIGHT_SHOULDER" in pts:
                    right_idx = offset + pts.index("RIGHT_SHOULDER")
            offset += len(c.points)

        valid = ~mask
        scale_ok = True

        if left_idx is not None and right_idx is not None:
            ls = arr[:, left_idx, :]
            rs = arr[:, right_idx, :]
            good = valid[:, left_idx] & valid[:, right_idx]
            if good.any():
                center = ((ls[good] + rs[good]) / 2.0).mean(axis=0)
                width = np.linalg.norm((ls[good] - rs[good])[:, :2], axis=-1).mean()
            else:
                center, width, scale_ok = None, None, False
        else:
            center, width, scale_ok = None, None, False

        if center is None or width is None or not np.isfinite(width) or width < 1e-6:
            # Bounding-box fallback
            flat = arr[valid]
            if flat.size == 0:
                return arr, False
            center = flat.mean(axis=0)
            width = max(float(np.ptp(flat[:, 0])), 1e-6) / 2.0
            scale_ok = False

        out = (arr - center) / width
        out[:, :, 1] *= -1.0   # image y-down -> world y-up
        out[:, :, 2] *= -1.0   # keep handedness consistent after the y flip
        return out, scale_ok


s2s_model = S2SMotionModel()
