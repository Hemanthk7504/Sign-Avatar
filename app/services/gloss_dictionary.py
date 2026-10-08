"""
Gloss -> Keyframe Pose dictionary.

Each entry defines the *peak* pose(s) of a sign as joint rotations (radians,
axis-angle-ish euler per joint, in the anatomical joint set defined below)
plus associated facial blendshape targets for non-manual features.

This is the "visual vocabulary" the motion generator draws from. In a full
research system this dictionary would be replaced by / fused with a learned
embedding space over a motion-capture corpus (e.g. How2Sign, BSL-Corpus);
here it is hand-authored so the pipeline is runnable end-to-end without
external datasets. New signs can be added without touching any other module.

Joint set (anatomically informed, upper-body focus since manual signing is
upper-body dominant; extend with lower body / full body as needed):
    spine, chest, neck, head,
    shoulder_l, elbow_l, wrist_l, hand_l,
    shoulder_r, elbow_r, wrist_r, hand_r

`hand_l` / `hand_r` store a single scalar 'curl' in x plus a 'spread' in y as
a compact handshape proxy (a full system would drive 20+ finger DOF per
hand from a handshape classifier).
"""
from __future__ import annotations
import hashlib
from typing import Dict, List

JOINTS = [
    "spine", "chest", "neck", "head",
    "shoulder_l", "elbow_l", "wrist_l", "hand_l",
    "shoulder_r", "elbow_r", "wrist_r", "hand_r",
]

REST_POSE: Dict[str, List[float]] = {
    "spine": [0.0, 0.0, 0.0],
    "chest": [0.0, 0.0, 0.0],
    "neck": [0.0, 0.0, 0.0],
    "head": [0.0, 0.0, 0.0],
    "shoulder_l": [0.05, 0.0, 0.15],
    "elbow_l": [0.1, 0.0, 0.0],
    "wrist_l": [0.0, 0.0, 0.0],
    "hand_l": [0.0, 0.0, 0.0],
    "shoulder_r": [0.05, 0.0, -0.15],
    "elbow_r": [0.1, 0.0, 0.0],
    "wrist_r": [0.0, 0.0, 0.0],
    "hand_r": [0.0, 0.0, 0.0],
}

REST_FACE: Dict[str, float] = {
    "eyebrows_up": 0.0,
    "eyebrows_down": 0.0,
    "mouth_open": 0.0,
    "mouth_smile": 0.1,
    "cheek_puff": 0.0,
}


def _pose(**overrides) -> Dict[str, List[float]]:
    p = {k: list(v) for k, v in REST_POSE.items()}
    p.update(overrides)
    return p


# Curated core vocabulary. Values are peak-pose joint rotations (radians).
SIGN_DICTIONARY: Dict[str, Dict] = {
    "hello": {
        "pose": _pose(shoulder_r=[0.9, 0.0, -0.3], elbow_r=[1.4, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.3], hand_r=[0.0, 0.3, 0.0]),
        "face": {"mouth_smile": 0.6},
        "two_handed": False,
    },
    "thank": {
        "pose": _pose(shoulder_r=[0.6, 0.0, -0.2], elbow_r=[0.2, 0.0, 0.0], wrist_r=[0.3, 0.0, 0.0], hand_r=[0.0, 0.0, 0.0]),
        "face": {"mouth_smile": 0.5},
        "two_handed": False,
    },
    "you": {
        "pose": _pose(shoulder_r=[0.5, 0.0, -0.25], elbow_r=[0.9, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.0], hand_r=[0.0, -0.2, 0.0]),
        "face": {},
        "two_handed": False,
    },
    "i": {
        "pose": _pose(shoulder_r=[0.4, 0.0, -0.1], elbow_r=[1.1, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.0], hand_r=[0.0, 0.0, 0.0]),
        "face": {},
        "two_handed": False,
    },
    "my": {
        "pose": _pose(shoulder_r=[0.5, 0.0, -0.1], elbow_r=[1.2, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.0], hand_r=[0.0, 0.0, 0.0]),
        "face": {},
        "two_handed": False,
    },
    "name": {
        "pose": _pose(
            shoulder_r=[0.7, 0.0, -0.2], elbow_r=[1.0, 0.0, 0.0], wrist_r=[0.2, 0.0, 0.0], hand_r=[0.0, 0.0, 0.0],
            shoulder_l=[0.7, 0.0, 0.2], elbow_l=[1.0, 0.0, 0.0], wrist_l=[-0.2, 0.0, 0.0], hand_l=[0.0, 0.0, 0.0],
        ),
        "face": {},
        "two_handed": True,
    },
    "please": {
        "pose": _pose(shoulder_r=[0.5, 0.0, -0.15], elbow_r=[0.3, 0.0, 0.0], wrist_r=[0.0, 0.3, 0.0], hand_r=[0.0, 0.0, 0.0]),
        "face": {"mouth_smile": 0.3},
        "two_handed": False,
    },
    "sorry": {
        "pose": _pose(shoulder_r=[0.6, 0.0, -0.1], elbow_r=[0.3, 0.0, 0.0], wrist_r=[0.0, 0.3, 0.0], hand_r=[0.1, 0.0, 0.0]),
        "face": {"eyebrows_down": 0.4, "mouth_open": 0.1},
        "two_handed": False,
    },
    "yes": {
        "pose": _pose(shoulder_r=[0.4, 0.0, -0.1], elbow_r=[0.9, 0.0, 0.0], wrist_r=[0.4, 0.0, 0.0], hand_r=[0.6, 0.0, 0.0]),
        "face": {"mouth_smile": 0.4},
        "two_handed": False,
    },
    "no": {
        "pose": _pose(shoulder_r=[0.35, 0.0, -0.1], elbow_r=[0.8, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.0], hand_r=[0.0, 0.4, 0.0]),
        "face": {"eyebrows_down": 0.3},
        "two_handed": False,
    },
    "good": {
        "pose": _pose(shoulder_r=[0.7, 0.0, -0.2], elbow_r=[0.2, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.0], hand_r=[0.0, 0.0, 0.0]),
        "face": {"mouth_smile": 0.6},
        "two_handed": False,
    },
    "bad": {
        "pose": _pose(shoulder_r=[0.6, 0.0, -0.15], elbow_r=[0.4, 0.0, 0.0], wrist_r=[0.5, 0.0, 0.0], hand_r=[0.0, 0.0, 0.0]),
        "face": {"eyebrows_down": 0.4, "mouth_smile": -0.3},
        "two_handed": False,
    },
    "love": {
        "pose": _pose(
            shoulder_r=[0.9, 0.0, -0.3], elbow_r=[1.2, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.0], hand_r=[0.3, 0.0, 0.0],
            shoulder_l=[0.9, 0.0, 0.3], elbow_l=[1.2, 0.0, 0.0], wrist_l=[0.0, 0.0, 0.0], hand_l=[0.3, 0.0, 0.0],
        ),
        "face": {"mouth_smile": 0.7},
        "two_handed": True,
    },
    "help": {
        "pose": _pose(
            shoulder_r=[0.7, 0.0, -0.1], elbow_r=[0.6, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.0], hand_r=[0.0, 0.0, 0.0],
            shoulder_l=[0.5, 0.0, 0.1], elbow_l=[0.5, 0.0, 0.0], wrist_l=[0.0, 0.0, 0.0], hand_l=[0.0, 0.0, 0.0],
        ),
        "face": {},
        "two_handed": True,
    },
    "want": {
        "pose": _pose(
            shoulder_r=[0.5, 0.0, -0.15], elbow_r=[0.9, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.0], hand_r=[0.0, 0.2, 0.0],
            shoulder_l=[0.5, 0.0, 0.15], elbow_l=[0.9, 0.0, 0.0], wrist_l=[0.0, 0.0, 0.0], hand_l=[0.0, -0.2, 0.0],
        ),
        "face": {},
        "two_handed": True,
    },
    "go": {
        "pose": _pose(shoulder_r=[0.6, 0.0, -0.3], elbow_r=[0.3, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.0], hand_r=[0.0, 0.0, 0.0]),
        "face": {},
        "two_handed": False,
    },
    "eat": {
        "pose": _pose(shoulder_r=[0.5, 0.0, -0.05], elbow_r=[1.3, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.0], hand_r=[0.3, 0.0, 0.0]),
        "face": {"mouth_open": 0.3},
        "two_handed": False,
    },
    "drink": {
        "pose": _pose(shoulder_r=[0.6, 0.0, -0.1], elbow_r=[1.4, 0.0, 0.0], wrist_r=[0.3, 0.0, 0.0], hand_r=[0.0, 0.0, 0.0]),
        "face": {"mouth_open": 0.2},
        "two_handed": False,
    },
    "water": {
        "pose": _pose(shoulder_r=[0.5, 0.0, -0.1], elbow_r=[1.2, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.0], hand_r=[0.4, 0.0, 0.0]),
        "face": {},
        "two_handed": False,
    },
    "food": {
        "pose": _pose(shoulder_r=[0.5, 0.0, -0.05], elbow_r=[1.3, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.0], hand_r=[0.3, 0.0, 0.0]),
        "face": {},
        "two_handed": False,
    },
    "home": {
        "pose": _pose(shoulder_r=[0.8, 0.0, -0.1], elbow_r=[1.5, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.0], hand_r=[0.0, 0.0, 0.0]),
        "face": {},
        "two_handed": False,
    },
    "work": {
        "pose": _pose(
            shoulder_r=[0.5, 0.0, -0.15], elbow_r=[0.5, 0.0, 0.0], wrist_r=[0.4, 0.0, 0.0], hand_r=[0.0, 0.0, 0.0],
            shoulder_l=[0.5, 0.0, 0.15], elbow_l=[0.5, 0.0, 0.0], wrist_l=[0.0, 0.0, 0.0], hand_l=[0.0, 0.0, 0.0],
        ),
        "face": {},
        "two_handed": True,
    },
    "school": {
        "pose": _pose(
            shoulder_r=[0.6, 0.0, -0.2], elbow_r=[0.4, 0.0, 0.0], wrist_r=[0.2, 0.0, 0.0], hand_r=[0.0, 0.0, 0.0],
            shoulder_l=[0.6, 0.0, 0.2], elbow_l=[0.4, 0.0, 0.0], wrist_l=[-0.2, 0.0, 0.0], hand_l=[0.0, 0.0, 0.0],
        ),
        "face": {},
        "two_handed": True,
    },
    "friend": {
        "pose": _pose(
            shoulder_r=[0.5, 0.0, -0.1], elbow_r=[0.6, 0.0, 0.0], wrist_r=[0.3, 0.0, 0.0], hand_r=[0.2, 0.0, 0.0],
            shoulder_l=[0.5, 0.0, 0.1], elbow_l=[0.6, 0.0, 0.0], wrist_l=[-0.3, 0.0, 0.0], hand_l=[0.2, 0.0, 0.0],
        ),
        "face": {"mouth_smile": 0.4},
        "two_handed": True,
    },
    "family": {
        "pose": _pose(
            shoulder_r=[0.6, 0.0, -0.2], elbow_r=[0.9, 0.0, 0.0], wrist_r=[0.0, 0.2, 0.0], hand_r=[0.0, 0.0, 0.0],
            shoulder_l=[0.6, 0.0, 0.2], elbow_l=[0.9, 0.0, 0.0], wrist_l=[0.0, -0.2, 0.0], hand_l=[0.0, 0.0, 0.0],
        ),
        "face": {"mouth_smile": 0.3},
        "two_handed": True,
    },
    "happy": {
        "pose": _pose(
            shoulder_r=[0.6, 0.0, -0.2], elbow_r=[0.4, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.0], hand_r=[0.0, 0.0, 0.0],
            shoulder_l=[0.6, 0.0, 0.2], elbow_l=[0.4, 0.0, 0.0], wrist_l=[0.0, 0.0, 0.0], hand_l=[0.0, 0.0, 0.0],
        ),
        "face": {"mouth_smile": 0.8, "eyebrows_up": 0.3},
        "two_handed": True,
    },
    "sad": {
        "pose": _pose(shoulder_r=[0.5, 0.0, -0.05], elbow_r=[0.6, 0.0, 0.0], wrist_r=[0.0, 0.0, 0.0], hand_r=[0.0, 0.0, 0.0]),
        "face": {"mouth_smile": -0.5, "eyebrows_down": 0.4},
        "two_handed": False,
    },
}

# --- Fingerspelling fallback -------------------------------------------------
# A-Z alphabet handshapes (single dominant hand). Used for any gloss word not
# present in SIGN_DICTIONARY so the system is never restricted to a closed
# vocabulary — it degrades gracefully to letter-by-letter spelling.
_ALPHABET = "abcdefghijklmnopqrstuvwxyz"


def _letter_pose(letter: str) -> Dict[str, List[float]]:
    """Deterministic, distinct-looking handshape per letter (proxy for real
    finger DOF). Uses a hash so every letter gets a stable, visually distinct
    wrist/hand configuration without hand-authoring 26 anatomical handshapes.
    """
    h = int(hashlib.md5(letter.encode()).hexdigest(), 16)
    curl = ((h % 100) / 100.0) * 0.9
    spread = (((h // 100) % 100) / 100.0 - 0.5) * 0.8
    twist = (((h // 10000) % 100) / 100.0 - 0.5) * 1.2
    return _pose(
        shoulder_r=[0.5, 0.0, -0.15],
        elbow_r=[1.1, 0.0, 0.0],
        wrist_r=[twist, 0.0, 0.0],
        hand_r=[curl, spread, 0.0],
    )


FINGERSPELL_DICTIONARY: Dict[str, Dict] = {
    letter: {"pose": _letter_pose(letter), "face": {}, "two_handed": False}
    for letter in _ALPHABET
}


def lookup_sign(word: str) -> Dict:
    """Return {'pose', 'face', 'two_handed'} for a gloss word, or None."""
    return SIGN_DICTIONARY.get(word.lower())


def fingerspell(word: str) -> List[Dict]:
    """Return a list of letter pose entries used to spell an out-of-vocabulary word."""
    return [FINGERSPELL_DICTIONARY[c] for c in word.lower() if c in FINGERSPELL_DICTIONARY]


def known_vocabulary() -> List[str]:
    return sorted(SIGN_DICTIONARY.keys())
