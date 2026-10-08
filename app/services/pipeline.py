"""
End-to-end orchestration: (speech | text) -> motion.

Two motion *formats* flow through this pipeline:

  "landmarks" — real MediaPipe Holistic 3D landmark positions produced by the
                s2s backend (real captured human motion), including full
                21-point hands and face landmarks.
  "joints"    — per-joint Euler rotations produced by the procedural or
                signspark backends, driving a primitive humanoid rig.

The frontend picks its renderer from the `format` field, so both work without
the client needing to know which backend ran.

Backend selection is settings.MOTION_BACKEND, with automatic fallback to
"procedural" if the requested backend isn't installed/configured — the app
never hard-fails because of a missing model.
"""
import logging
from typing import List, Optional

from app.config import settings
from app.schemas import Pose
from app.services.motion_generator import motion_model as procedural_model
from app.services.speech_to_text import transcribe_audio_bytes
from app.services.text_to_gloss import text_to_gloss

logger = logging.getLogger("sign_avatar.pipeline")


def _procedural_payload(text: str, variant: str, style: str, style_seed: Optional[int]) -> dict:
    gloss_tokens = text_to_gloss(text)
    frames: List[Pose] = procedural_model.generate(
        gloss_tokens, variant=variant, style=style, seed=style_seed
    )
    return {
        "format": "joints",
        "backend": "procedural",
        "fps": settings.TARGET_FPS,
        "frames": [f.model_dump() for f in frames],
        "duration": frames[-1].t if frames else 0.0,
        "gloss_sequence": [t.model_dump() for t in gloss_tokens],
        "variant": variant,
        "style": style,
    }


def generate_motion(
    text: str,
    variant: str = settings.DEFAULT_VARIANT,
    style: str = "neutral",
    style_seed: Optional[int] = None,
    backend: Optional[str] = None,
) -> dict:
    """Produce a motion payload for `text` using the configured backend,
    falling back to the procedural backend on any unavailability."""
    backend = backend or settings.MOTION_BACKEND

    if backend == "diffusion":
        try:
            from app.services.diffusion_adapter import DiffusionUnavailable, diffusion_backend
            try:
                out = diffusion_backend.generate_landmarks(
                    text, variant=variant, style=style, seed=style_seed
                )
                out["backend"] = "diffusion"
                out["variant"] = variant
                out["style"] = style
                out["duration"] = len(out["frames"]) / max(out["fps"], 1)
                out["gloss_sequence"] = [
                    {"word": str(g), "gloss": str(g).upper(), "non_manual": [], "fingerspelled": False}
                    for g in out.get("gloss", [])
                ]
                return out
            except DiffusionUnavailable as exc:
                logger.warning("diffusion backend unavailable (%s) — falling back to s2s", exc)
                backend = "s2s"
        except ImportError as exc:
            logger.warning("diffusion adapter import failed (%s) — falling back to s2s", exc)
            backend = "s2s"

    if backend == "s2s":
        try:
            from app.services.s2s_adapter import S2SUnavailable, s2s_model
            try:
                out = s2s_model.generate_landmarks(
                    text, variant=variant, style=style, seed=style_seed
                )
                out["backend"] = "s2s"
                out["variant"] = variant
                out["style"] = style
                out["duration"] = len(out["frames"]) / max(out["fps"], 1)
                out["gloss_sequence"] = [
                    {"word": str(g), "gloss": str(g).upper(), "non_manual": [], "fingerspelled": False}
                    for g in out.get("gloss", [])
                ] or [t.model_dump() for t in text_to_gloss(text)]
                return out
            except S2SUnavailable as exc:
                logger.warning("s2s backend unavailable (%s) — falling back to procedural", exc)
        except ImportError as exc:
            logger.warning("s2s adapter import failed (%s) — falling back to procedural", exc)

    elif backend == "signspark":
        try:
            from app.services.signspark_adapter import SignSparkUnavailable, signspark_model
            try:
                frames = signspark_model.generate(
                    text=text, gloss_tokens=text_to_gloss(text),
                    variant=variant, style=style, seed=style_seed,
                )
                return {
                    "format": "joints",
                    "backend": "signspark",
                    "fps": settings.TARGET_FPS,
                    "frames": [f.model_dump() for f in frames],
                    "duration": frames[-1].t if frames else 0.0,
                    "gloss_sequence": [t.model_dump() for t in text_to_gloss(text)],
                    "variant": variant,
                    "style": style,
                }
            except SignSparkUnavailable as exc:
                logger.warning("signspark backend unavailable (%s) — falling back to procedural", exc)
        except ImportError as exc:
            logger.warning("signspark adapter import failed (%s) — falling back to procedural", exc)

    return _procedural_payload(text, variant, style, style_seed)


def generate_from_text(
    text: str,
    variant: str = settings.DEFAULT_VARIANT,
    style: str = "neutral",
    style_seed: Optional[int] = None,
) -> dict:
    return generate_motion(text, variant=variant, style=style, style_seed=style_seed)


def generate_from_audio(
    audio_bytes: bytes,
    content_type: str = "audio/webm",
    variant: str = settings.DEFAULT_VARIANT,
    style: str = "neutral",
    style_seed: Optional[int] = None,
) -> dict:
    transcript = transcribe_audio_bytes(audio_bytes, content_type=content_type)
    payload = generate_motion(transcript, variant=variant, style=style, style_seed=style_seed)
    payload["transcript"] = transcript
    return payload
