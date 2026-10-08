"""
REST endpoints for non-streaming (request/response) usage of the pipeline,
plus supporting vocabulary/health endpoints.
"""
import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.config import settings
from app.schemas import GenerateTextRequest, VocabularyItem
from app.services import gloss_dictionary as gd
from app.services.pipeline import generate_from_audio, generate_from_text

logger = logging.getLogger("sign_avatar.api")
router = APIRouter(prefix="/api", tags=["generation"])


@router.get("/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME}


@router.get("/vocabulary", response_model=list[VocabularyItem])
def vocabulary(variant: str = settings.DEFAULT_VARIANT):
    return [VocabularyItem(word=w, variant=variant) for w in gd.known_vocabulary()]


@router.get("/config")
def config():
    return {
        "fps": settings.TARGET_FPS,
        "variants": settings.SUPPORTED_VARIANTS,
        "default_variant": settings.DEFAULT_VARIANT,
        "styles": ["neutral", "expressive", "compact"],
        "backend": settings.MOTION_BACKEND,
    }


@router.post("/generate/text")
def generate_text(req: GenerateTextRequest):
    try:
        return generate_from_text(req.text, variant=req.variant, style=req.style, style_seed=req.style_seed)
    except Exception as exc:  # noqa: BLE001
        logger.exception("generate_text failed")
        raise HTTPException(500, str(exc)) from exc


@router.post("/generate/speech")
async def generate_speech(
    audio: UploadFile = File(...),
    variant: str = Form(settings.DEFAULT_VARIANT),
    style: str = Form("neutral"),
):
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(400, "Empty audio upload")
    try:
        return generate_from_audio(
            audio_bytes,
            content_type=audio.content_type or "audio/webm",
            variant=variant,
            style=style,
        )
    except ValueError as exc:
        # Expected failure modes: undecodable audio / no speech recognized
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("generate_speech failed")
        raise HTTPException(500, str(exc)) from exc
