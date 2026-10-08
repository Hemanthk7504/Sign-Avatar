"""
Pose representation + dataset construction for the sign-motion diffusion model.

REPRESENTATION (the "anatomically informed 3D body representation" of the
abstract, instantiated concretely):

    body   : 8 upper-body landmarks  (shoulders, elbows, wrists, hips)
    hands  : 21 landmarks per hand   (full MANO-style finger articulation)
    face   : 16 subsampled landmarks (non-manual features: brow/eye/mouth region)
    ------------------------------------------------------------------
    total  : 66 points x 3 coords = 198 dims per frame

Face landmarks are a uniform subsample of the 128-point face component. The
upstream pose files label face points with bare numeric MediaPipe indices and
ship no semantic name map, so a *semantic* selection (exactly which points are
the eyebrows vs. the lips) is not available here — the subsample captures
gross facial configuration, which is enough for the model to learn that
question/negation contexts look different, but it is NOT a clean
brow-raise/brow-furrow control signal. Wiring a semantic FLAME/MediaPipe face
map is the natural upgrade for finer non-manual control.

NORMALIZATION: every sequence is centered on the shoulder midpoint and scaled
by shoulder width, making the representation translation- and scale-invariant
across signers — the same normalization the renderer expects.

Each sign is resampled to a fixed SEQ_LEN frames so the model sees a fixed
-size tensor; per-sign true duration is stored so it can be restored at
generation time.
"""
from __future__ import annotations

import csv
import logging
import os
from dataclasses import dataclass
from typing import List, Optional

import numpy as np

logger = logging.getLogger("sign_avatar.diffusion.data")

SEQ_LEN = 48                 # frames per sign (≈1.9s at 25fps)
N_BODY = 8
N_HAND = 21
N_FACE = 16
N_POINTS = N_BODY + 2 * N_HAND + N_FACE      # 66
FEAT_DIM = N_POINTS * 3                       # 198

# Component names as they appear in pose-format headers
C_BODY = "POSE_LANDMARKS"
C_FACE = "FACE_LANDMARKS"
C_LHAND = "LEFT_HAND_LANDMARKS"
C_RHAND = "RIGHT_HAND_LANDMARKS"


@dataclass
class SignSample:
    gloss: str
    signed_language: str
    motion: np.ndarray      # [SEQ_LEN, FEAT_DIM] float32, normalized
    true_frames: int        # original frame count before resampling


def _component_slices(pose) -> dict:
    """Map component name -> (offset, count) in the flattened point axis."""
    out, offset = {}, 0
    for c in pose.header.components:
        out[c.name] = (offset, len(c.points))
        offset += len(c.points)
    return out


def _resample(arr: np.ndarray, target: int) -> np.ndarray:
    """Linearly resample [T, ...] to [target, ...] along time."""
    t = arr.shape[0]
    if t == target:
        return arr
    if t == 1:
        return np.repeat(arr, target, axis=0)
    src = np.linspace(0.0, 1.0, t)
    dst = np.linspace(0.0, 1.0, target)
    flat = arr.reshape(t, -1)
    out = np.empty((target, flat.shape[1]), dtype=arr.dtype)
    for d in range(flat.shape[1]):
        out[:, d] = np.interp(dst, src, flat[:, d])
    return out.reshape(target, *arr.shape[1:])


def pose_to_features(pose) -> Optional[np.ndarray]:
    """Convert a pose-format Pose into [T, FEAT_DIM] normalized features.
    Returns None if the pose lacks the components we need."""
    slices = _component_slices(pose)
    if C_BODY not in slices:
        return None

    data = pose.body.data                       # masked [T, people, P, 3]
    if data.shape[0] == 0:
        return None
    arr = np.asarray(data[:, 0, :, :], dtype=np.float64)
    mask = np.ma.getmaskarray(data[:, 0, :, :]).any(axis=-1)   # [T, P]
    arr = np.where(mask[..., None], np.nan, arr)

    # --- normalize on shoulders ---
    b_off, b_cnt = slices[C_BODY]
    body_pts = list(pose.header.components[
        [c.name for c in pose.header.components].index(C_BODY)
    ].points)
    try:
        li = b_off + body_pts.index("LEFT_SHOULDER")
        ri = b_off + body_pts.index("RIGHT_SHOULDER")
    except ValueError:
        return None

    ls, rs = arr[:, li, :], arr[:, ri, :]
    valid = np.isfinite(ls).all(-1) & np.isfinite(rs).all(-1)
    if not valid.any():
        return None
    center = ((ls[valid] + rs[valid]) / 2.0).mean(axis=0)
    width = float(np.linalg.norm((ls[valid] - rs[valid])[:, :2], axis=-1).mean())
    if not np.isfinite(width) or width < 1e-6:
        return None

    arr = (arr - center) / width
    arr[:, :, 1] *= -1.0      # y-down -> y-up
    arr[:, :, 2] *= -1.0

    # --- select the point subset ---
    def take(name: str, n_expected: int, subsample: bool = False) -> np.ndarray:
        if name not in slices:
            return np.full((arr.shape[0], n_expected, 3), np.nan)
        off, cnt = slices[name]
        block = arr[:, off:off + cnt, :]
        if subsample:
            idx = np.linspace(0, cnt - 1, n_expected).astype(int)
            return block[:, idx, :]
        if cnt >= n_expected:
            return block[:, :n_expected, :]
        pad = np.full((arr.shape[0], n_expected - cnt, 3), np.nan)
        return np.concatenate([block, pad], axis=1)

    parts = [
        take(C_BODY, N_BODY),
        take(C_LHAND, N_HAND),
        take(C_RHAND, N_HAND),
        take(C_FACE, N_FACE, subsample=True),
    ]
    sel = np.concatenate(parts, axis=1)          # [T, N_POINTS, 3]

    # Missing points (e.g. an undetected hand) -> 0 after normalization, which
    # sits at the shoulder midpoint. The model learns this as "hand absent".
    sel = np.nan_to_num(sel, nan=0.0, posinf=0.0, neginf=0.0)
    return sel.reshape(sel.shape[0], -1).astype(np.float32)


def load_dataset(
    lexicon_dirs: List[str],
    max_samples: Optional[int] = None,
) -> List[SignSample]:
    """
    Scan one or more lexicon directories (each containing index.csv plus .pose
    files) and build the training set.

    This is the "motion-capture corpus" the diffusion model trains on. With
    only the bundled ASL fingerspelling alphabet you get 26 samples, which is
    enough to verify the training loop runs but far too few to learn general
    signing. Download a real lexicon (e.g. SignSuisse, thousands of signs) to
    train something meaningful.
    """
    from pose_format import Pose

    samples: List[SignSample] = []
    for lex_dir in lexicon_dirs:
        index_path = os.path.join(lex_dir, "index.csv")
        if not os.path.isfile(index_path):
            logger.warning("No index.csv in %s — skipping", lex_dir)
            continue

        with open(index_path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if max_samples and len(samples) >= max_samples:
                    break
                rel = row.get("path")
                if not rel:
                    continue
                pose_path = os.path.join(lex_dir, rel)
                if not os.path.isfile(pose_path):
                    continue
                try:
                    with open(pose_path, "rb") as pf:
                        pose = Pose.read(pf.read())
                    feats = pose_to_features(pose)
                except Exception as exc:  # noqa: BLE001
                    logger.debug("Failed to read %s: %s", pose_path, exc)
                    continue
                if feats is None or feats.shape[0] < 2:
                    continue

                gloss = (row.get("glosses") or row.get("words") or "").strip()
                if not gloss:
                    continue

                samples.append(SignSample(
                    gloss=gloss.lower(),
                    signed_language=(row.get("signed_language") or "ase").strip(),
                    motion=_resample(feats, SEQ_LEN),
                    true_frames=int(feats.shape[0]),
                ))

    logger.info("Loaded %d sign samples from %d lexicon(s)", len(samples), len(lexicon_dirs))
    return samples


def build_vocab(samples: List[SignSample]) -> dict:
    """gloss -> index, with 0 reserved for the unconditional/unknown token
    (needed for classifier-free guidance)."""
    vocab = {"<unk>": 0}
    for s in samples:
        if s.gloss not in vocab:
            vocab[s.gloss] = len(vocab)
    return vocab


def compute_stats(samples: List[SignSample]) -> tuple:
    """Per-dimension mean/std used to standardize the model's input space."""
    if not samples:
        return np.zeros(FEAT_DIM, np.float32), np.ones(FEAT_DIM, np.float32)
    stacked = np.concatenate([s.motion for s in samples], axis=0)   # [N*T, D]
    mean = stacked.mean(axis=0)
    std = stacked.std(axis=0)
    std[std < 1e-4] = 1.0
    return mean.astype(np.float32), std.astype(np.float32)
