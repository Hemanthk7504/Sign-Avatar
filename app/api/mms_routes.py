"""
MMS Mocap synthesis API routes.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.mms_service import is_mms_available, synthesize_mms_animation

router = APIRouter(prefix="/api/mms", tags=["mms"])


class MmsSynthesisRequest(BaseModel):
    text: str = Field(..., description="Text or sign gloss sequence to synthesize via mocap", min_length=1)
    force_recompute: bool = Field(False, description="Bypass cache and regenerate animation")


@router.get("/status")
def get_mms_status():
    """Check whether MMS-Player and Blender 4.2 LTS are available."""
    available = is_mms_available()
    return {
        "available": available,
        "engine": "Blender 4.2.23 LTS (DFKI MMS-Player)",
        "vocabulary": "German / International Sign MoCap Dictionary + ASL Fingerspelling",
    }


@router.post("/synthesize")
def synthesize(request: MmsSynthesisRequest):
    """Synthesize high-fidelity human mocap GLB animation from text."""
    if not is_mms_available():
        raise HTTPException(
            status_code=503,
            detail="MMS-Player backend is not configured or Blender 4.2 is missing.",
        )
    try:
        result = synthesize_mms_animation(
            text=request.text,
            force_recompute=request.force_recompute,
        )
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
