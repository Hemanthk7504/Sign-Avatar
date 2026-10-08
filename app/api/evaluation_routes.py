"""
Evaluation endpoints: quantitative metrics + human intelligibility study.

These implement the abstract's evaluation plan as a usable part of the app
rather than a separate offline script, so ratings can be collected during a
live demo session with interpreters or Deaf participants.
"""
import logging
from typing import Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.evaluation import study as study_mod
from app.services.evaluation.metrics import evaluate_against_reference

logger = logging.getLogger("sign_avatar.api.eval")
router = APIRouter(prefix="/api/evaluation", tags=["evaluation"])


class ParticipantRequest(BaseModel):
    role: str = Field(..., description=f"One of {study_mod.PARTICIPANT_ROLES}")
    years_signing: Optional[float] = None
    primary_language: Optional[str] = None


class ResponseRequest(BaseModel):
    participant_id: str
    role: str
    stimulus_text: str
    backend: str
    variant: str = "ASL"
    free_recall: str = Field(..., description="What the participant understood, collected BEFORE showing the target text")
    ratings: Dict[str, int] = Field(..., description="comprehension/naturalness/grammaticality, each 1-5")
    gloss_sequence: List[str] = []
    notes: str = ""


@router.post("/participant")
def register_participant(req: ParticipantRequest):
    try:
        return study_mod.new_participant(
            role=req.role,
            years_signing=req.years_signing,
            primary_language=req.primary_language,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/response")
def submit_response(req: ResponseRequest):
    try:
        return study_mod.record_response(
            participant_id=req.participant_id,
            role=req.role,
            stimulus_text=req.stimulus_text,
            backend=req.backend,
            variant=req.variant,
            free_recall=req.free_recall,
            ratings=req.ratings,
            gloss_sequence=req.gloss_sequence,
            notes=req.notes,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/summary")
def study_summary():
    return study_mod.summarize()


@router.get("/roles")
def roles():
    return {
        "roles": list(study_mod.PARTICIPANT_ROLES),
        "likert_fields": list(study_mod.LIKERT_FIELDS),
    }


@router.post("/metrics")
def run_metrics(backend: str = "diffusion", max_glosses: int = 20):
    """
    Score a backend's generated motion against the real-capture reference
    corpus, over glosses that exist in both.

    Runs synchronously and can take a while (diffusion sampling is the slow
    part), so it's intended for offline/benchmark use, not per-request.
    """
    try:
        import os

        import spoken_to_signed

        from app.services.diffusion.data import load_dataset

        fs_dir = os.path.join(os.path.dirname(spoken_to_signed.__file__),
                              "assets", "fingerspelling_lexicon")
        lex = os.environ.get("S2S_LEXICON_DIR", "")
        dirs = [d for d in (fs_dir, lex) if d and os.path.isdir(d)]
        samples = load_dataset(dirs)
        if not samples:
            raise HTTPException(400, "No reference corpus available")

        # Reference: one real capture per gloss
        reference: Dict[str, np.ndarray] = {}
        for s in samples:
            reference.setdefault(s.gloss, s.motion)
        glosses = sorted(reference)[:max_glosses]

        generated: Dict[str, np.ndarray] = {}
        if backend == "diffusion":
            from app.services.diffusion_adapter import (
                DiffusionUnavailable,
                diffusion_backend,
            )
            try:
                if not diffusion_backend.is_available():
                    raise HTTPException(400, diffusion_backend._reason_or_default())
                diffusion_backend._load()
                for g in glosses:
                    generated[g] = diffusion_backend._sample_gloss(g, guidance_scale=2.0, seed=0)
            except DiffusionUnavailable as exc:
                raise HTTPException(400, str(exc)) from exc
        else:
            raise HTTPException(400, f"Metrics not implemented for backend '{backend}'")

        result = evaluate_against_reference(
            {g: generated[g] for g in glosses if g in generated},
            {g: reference[g] for g in glosses},
        )
        result["backend"] = backend
        return result

    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("Metrics run failed")
        raise HTTPException(500, str(exc)) from exc
