"""
Human evaluation study: intelligibility ratings from certified interpreters
and Deaf/hard-of-hearing participants.

This implements the second half of the abstract's evaluation plan — the part
that actually matters, since motion-realism metrics cannot tell you whether a
sign is understandable.

Design follows standard SLP evaluation practice:
  - Participants are shown a generated sequence and asked to *write what they
    understood* (free recall) BEFORE seeing the intended text. Showing the
    target first contaminates the response — people rate what they were
    primed to see.
  - Then Likert ratings on three separate axes, because a sequence can be
    smooth but meaningless, or correct but robotic:
        comprehension  — did you understand it?
        naturalness    — did it look like human signing?
        grammaticality — were non-manual features (face/head) correct?
  - Participant role and self-reported fluency are recorded so interpreter
    and Deaf-community responses can be reported separately rather than
    averaged into one misleading number.

Storage is a plain JSONL file: no database dependency, append-only, easy to
load into pandas or R for the actual analysis.

ETHICS NOTE: running this as real research on Deaf participants needs informed
consent, fair compensation, and almost certainly IRB/ethics-board approval at
your institution. Deaf-led review of the study design is strongly advised —
the community has been repeatedly harmed by sign-language avatar work
conducted without its involvement. This module stores no personal identifiers
beyond an opaque participant ID for exactly that reason.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

logger = logging.getLogger("sign_avatar.evaluation")

STUDY_PATH = os.environ.get("STUDY_PATH", "./data/study_responses.jsonl")

PARTICIPANT_ROLES = (
    "certified_interpreter",
    "deaf",
    "deaf_native_signer",
    "hard_of_hearing",
    "hearing_signer",
    "hearing_non_signer",
    "asl_teacher",
    "linguist",
    "researcher",
)

LIKERT_FIELDS = ("comprehension", "naturalness", "grammaticality")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_participant(role: str, years_signing: Optional[float] = None,
                    primary_language: Optional[str] = None) -> dict:
    """Register a participant. Returns an opaque ID; no names or contact
    details are ever stored here."""
    if role not in PARTICIPANT_ROLES:
        raise ValueError(f"role must be one of {PARTICIPANT_ROLES}")
    return {
        "participant_id": uuid.uuid4().hex[:12],
        "role": role,
        "years_signing": years_signing,
        "primary_language": primary_language,
        "registered_at": _now(),
    }


def record_response(
    participant_id: str,
    role: str,
    stimulus_text: str,
    backend: str,
    variant: str,
    free_recall: str,
    ratings: Dict[str, int],
    gloss_sequence: Optional[List[str]] = None,
    notes: str = "",
    path: str = STUDY_PATH,
) -> dict:
    """
    Append one rating to the study log.

    free_recall : what the participant understood, collected BEFORE they saw
                  `stimulus_text`. This is the primary intelligibility measure;
                  the Likert scores are secondary.
    ratings     : {"comprehension": 1-5, "naturalness": 1-5, "grammaticality": 1-5}
    """
    for field in LIKERT_FIELDS:
        if field not in ratings:
            raise ValueError(f"Missing rating '{field}'")
        v = ratings[field]
        if not isinstance(v, int) or not 1 <= v <= 5:
            raise ValueError(f"Rating '{field}' must be an integer 1-5, got {v!r}")

    entry = {
        "response_id": uuid.uuid4().hex[:12],
        "participant_id": participant_id,
        "role": role,
        "stimulus_text": stimulus_text,
        "gloss_sequence": gloss_sequence or [],
        "backend": backend,
        "variant": variant,
        "free_recall": free_recall,
        "ratings": {k: int(ratings[k]) for k in LIKERT_FIELDS},
        "notes": notes,
        "recorded_at": _now(),
    }

    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def load_responses(path: str = STUDY_PATH) -> List[dict]:
    if not os.path.isfile(path):
        return []
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    logger.warning("Skipping malformed study line")
    return out


def summarize(path: str = STUDY_PATH) -> dict:
    """
    Aggregate results, broken out by backend and by participant role.

    Deliberately reports per-role means rather than one pooled average:
    pooling interpreter and hearing-non-signer responses produces a number
    that describes nobody. Also reports n for every cell so small-sample
    cells are visible rather than hidden behind a mean.
    """
    responses = load_responses(path)
    if not responses:
        return {"n": 0, "message": f"No responses recorded yet at {path}"}

    def mean(vals):
        return round(sum(vals) / len(vals), 3) if vals else None

    by_backend: Dict[str, Dict] = {}
    by_role: Dict[str, Dict] = {}

    for r in responses:
        for bucket, key in ((by_backend, r.get("backend", "unknown")),
                            (by_role, r.get("role", "unknown"))):
            cell = bucket.setdefault(key, {f: [] for f in LIKERT_FIELDS})
            for f in LIKERT_FIELDS:
                cell[f].append(r["ratings"][f])

    def fmt(bucket):
        return {
            k: {"n": len(v[LIKERT_FIELDS[0]]),
                **{f: mean(v[f]) for f in LIKERT_FIELDS}}
            for k, v in bucket.items()
        }

    # Community-validity check called for by the abstract
    community_roles = {"deaf", "hard_of_hearing", "certified_interpreter"}
    community_n = sum(1 for r in responses if r.get("role") in community_roles)

    return {
        "n": len(responses),
        "n_participants": len({r["participant_id"] for r in responses}),
        "by_backend": fmt(by_backend),
        "by_role": fmt(by_role),
        "community_responses": community_n,
        "community_validated": community_n >= 10,
        "caveat": (
            "Likert means are secondary. The primary intelligibility measure is "
            "the free_recall field, which requires qualitative coding (e.g. two "
            "independent raters scoring recall against intended meaning) and is "
            "deliberately not auto-scored here. 'community_validated' is a crude "
            "10-response floor, not a claim of statistical power."
        ),
    }
