"""
Pydantic schemas shared across REST and WebSocket interfaces.
"""
from typing import List, Optional, Literal
from pydantic import BaseModel, Field


class GenerateTextRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Free-form input text or transcript")
    variant: str = Field(default="ASL", description="Sign language variant, e.g. ASL, BSL, ISL")
    style: Optional[str] = Field(
        default="neutral",
        description="Personal signing style / speed profile: neutral | expressive | compact",
    )
    style_seed: Optional[int] = Field(
        default=None, description="Seed controlling the stochastic style variation"
    )


class Pose(BaseModel):
    """A single anatomically-informed 3D pose frame."""
    t: float                                   # timestamp in seconds from sequence start
    joints: dict                               # joint_name -> [x, y, z] rotation (radians)
    face: dict                                 # blendshape_name -> weight (0..1)
    root_translation: List[float] = [0.0, 0.0, 0.0]


class GlossToken(BaseModel):
    word: str
    gloss: str
    non_manual: List[str] = []                 # e.g. ["raised_eyebrows", "head_tilt"]
    fingerspelled: bool = False


class GenerateResponse(BaseModel):
    gloss_sequence: List[GlossToken]
    frames: List[Pose]
    fps: int
    duration: float
    variant: str
    style: str


class WSMessageIn(BaseModel):
    type: Literal["text", "audio_meta", "config"]
    text: Optional[str] = None
    variant: Optional[str] = None
    style: Optional[str] = None
    style_seed: Optional[int] = None


class VocabularyItem(BaseModel):
    word: str
    variant: str
    is_fingerspell_fallback: bool = False
