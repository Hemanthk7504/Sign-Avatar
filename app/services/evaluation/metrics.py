"""
Quantitative motion-realism metrics for generated sign motion.

Implements the "quantitative motion-realism metrics" half of the abstract's
evaluation plan. All metrics operate on the shared normalized landmark
representation, so any backend (diffusion / s2s / procedural) can be scored
against the same real-capture reference set.

Metrics
-------
APE      Average Position Error against a reference sequence (lower better).
         Sequences are time-normalized to the same length before comparison,
         so this measures spatial rather than duration error.

Jerk     Mean absolute third derivative of position. Real human motion is
         smooth; jitter and teleporting inflate this. Reported alongside the
         reference corpus's own jerk, since "lower" is only better down to
         the level real signers exhibit — a frozen avatar scores 0.

DTW      Dynamic Time Warping distance, which tolerates timing differences
         and so complements APE for signs performed at different speeds.

Diversity  Mean pairwise distance between generated samples for *different*
         glosses. Near-zero diversity means mode collapse (the model emits
         the same motion regardless of the requested sign) — an important
         failure mode for small diffusion models that APE alone hides.

Interpretation caveat: these are proxies. None of them measures whether a
Deaf viewer can actually understand the sign. That is what the human study in
`app/services/evaluation/study.py` is for, and it is the metric that counts.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np


def _time_normalize(seq: np.ndarray, target: int) -> np.ndarray:
    """Resample [T, D] to [target, D] linearly."""
    t = seq.shape[0]
    if t == target:
        return seq
    if t < 2:
        return np.repeat(seq, target, axis=0)[:target]
    src = np.linspace(0.0, 1.0, t)
    dst = np.linspace(0.0, 1.0, target)
    return np.stack([np.interp(dst, src, seq[:, d]) for d in range(seq.shape[1])], axis=1)


def average_position_error(pred: np.ndarray, ref: np.ndarray) -> float:
    """Mean Euclidean per-point error after time normalization.
    Inputs are [T, P*3]; returns error in shoulder-width units."""
    n = min(pred.shape[0], ref.shape[0])
    n = max(n, 2)
    p = _time_normalize(pred, n).reshape(n, -1, 3)
    r = _time_normalize(ref, n).reshape(n, -1, 3)
    p_pts = min(p.shape[1], r.shape[1])
    d = np.linalg.norm(p[:, :p_pts] - r[:, :p_pts], axis=-1)
    return float(np.mean(d))


def mean_jerk(seq: np.ndarray, fps: int = 25) -> float:
    """Mean absolute third derivative of position (smoothness proxy)."""
    if seq.shape[0] < 4:
        return 0.0
    pts = seq.reshape(seq.shape[0], -1, 3)
    dt = 1.0 / max(fps, 1)
    vel = np.diff(pts, axis=0) / dt
    acc = np.diff(vel, axis=0) / dt
    jerk = np.diff(acc, axis=0) / dt
    return float(np.mean(np.linalg.norm(jerk, axis=-1)))


def dtw_distance(pred: np.ndarray, ref: np.ndarray, band: Optional[int] = None) -> float:
    """Sakoe-Chiba-banded DTW over frame-wise Euclidean distance.
    Normalized by path length so sequences of different sizes compare fairly."""
    n, m = pred.shape[0], ref.shape[0]
    if n == 0 or m == 0:
        return float("inf")
    if band is None:
        band = max(n, m)

    cost = np.full((n + 1, m + 1), np.inf)
    cost[0, 0] = 0.0
    for i in range(1, n + 1):
        lo = max(1, i - band)
        hi = min(m, i + band)
        for j in range(lo, hi + 1):
            d = np.linalg.norm(pred[i - 1] - ref[j - 1])
            cost[i, j] = d + min(cost[i - 1, j], cost[i, j - 1], cost[i - 1, j - 1])
    return float(cost[n, m] / (n + m))


def diversity(samples: List[np.ndarray], max_pairs: int = 200) -> float:
    """Mean pairwise distance across generated samples (mode-collapse probe)."""
    if len(samples) < 2:
        return 0.0
    n = min(len(samples), 40)
    target = min(s.shape[0] for s in samples[:n])
    target = max(target, 2)
    norm = [_time_normalize(s, target) for s in samples[:n]]

    dists, pairs = [], 0
    for i in range(n):
        for j in range(i + 1, n):
            dists.append(float(np.mean(np.linalg.norm(
                norm[i].reshape(target, -1, 3) - norm[j].reshape(target, -1, 3), axis=-1
            ))))
            pairs += 1
            if pairs >= max_pairs:
                break
        if pairs >= max_pairs:
            break
    return float(np.mean(dists)) if dists else 0.0


def evaluate_against_reference(
    generated: Dict[str, np.ndarray],
    reference: Dict[str, np.ndarray],
    fps: int = 25,
) -> dict:
    """
    Score a set of generated signs against real-capture references.

    generated / reference: gloss -> [T, P*3] normalized motion
    Only glosses present in both are scored; the count is reported so a
    high score on two overlapping glosses can't be mistaken for coverage.
    """
    shared = sorted(set(generated) & set(reference))
    if not shared:
        return {"error": "No overlapping glosses between generated and reference sets",
                "n_scored": 0}

    apes, dtws, gen_jerks, ref_jerks = [], [], [], []
    for g in shared:
        apes.append(average_position_error(generated[g], reference[g]))
        dtws.append(dtw_distance(generated[g], reference[g]))
        gen_jerks.append(mean_jerk(generated[g], fps))
        ref_jerks.append(mean_jerk(reference[g], fps))

    return {
        "n_scored": len(shared),
        "glosses": shared,
        "ape_mean": float(np.mean(apes)),
        "ape_std": float(np.std(apes)),
        "dtw_mean": float(np.mean(dtws)),
        "jerk_generated": float(np.mean(gen_jerks)),
        "jerk_reference": float(np.mean(ref_jerks)),
        "jerk_ratio": float(np.mean(gen_jerks) / max(np.mean(ref_jerks), 1e-8)),
        "diversity_generated": diversity([generated[g] for g in shared]),
        "diversity_reference": diversity([reference[g] for g in shared]),
        "notes": (
            "APE/DTW in shoulder-width units. jerk_ratio near 1.0 means "
            "generated smoothness matches real capture; <<1 suggests an "
            "over-smoothed or frozen avatar, >>1 suggests jitter. "
            "diversity_generated near 0 indicates mode collapse. "
            "These are proxies for realism, not intelligibility."
        ),
    }
