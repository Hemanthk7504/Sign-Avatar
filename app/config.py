"""
Central configuration for the Sign Language Avatar Synthesis backend.
"""
import os
from pydantic import BaseModel


class Settings(BaseModel):
    APP_NAME: str = "Generative 3D Sign Language Avatar Synthesis"

    # Motion generation
    TARGET_FPS: int = 30                 # frames per second delivered to the avatar renderer
    FRAME_DURATION: float = 1.0 / 30.0   # seconds per frame
    SIGN_HOLD_FRAMES: int = 10           # frames a sign is "held" at its peak pose
    TRANSITION_FRAMES: int = 8           # frames used to interpolate between two signs
    COARTICULATION_BLEND: float = 0.35   # how much the next sign "leaks" into the current transition

    # Diffusion-model-shaped generation (see app/services/motion_generator.py)
    DIFFUSION_STEPS: int = 12            # denoising steps used by the procedural sampler
    NOISE_SCALE: float = 0.06            # stochastic style noise amplitude (radians)

    # Streaming
    STREAM_CHUNK_FRAMES: int = 6         # frames sent per websocket message (low-latency chunking)

    # Supported sign language variants (extend as gloss dictionaries are added)
    SUPPORTED_VARIANTS: tuple = ("ASL", "BSL", "ISL")
    DEFAULT_VARIANT: str = "ASL"

    # Motion backend:
    #   "diffusion"  - TRAINED diffusion model (this project's own; matches the
    #                  paper's architecture). Needs `python train_diffusion.py`.
    #   "s2s"        - REAL captured motion (MediaPipe Holistic landmarks) via
    #                  spoken-to-signed-translation. CPU-only, ~2.8x faster than
    #                  real-time. This is the recommended default.
    #   "procedural" - hand-authored keyframes + procedural sampler. No deps.
    #   "signspark"  - pretrained flow-matching model. Needs a CUDA GPU.
    # Any backend that isn't available falls back to "procedural" automatically.
    MOTION_BACKEND: str = os.environ.get("MOTION_BACKEND", "diffusion")


settings = Settings()
