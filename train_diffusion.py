"""
Train the sign-motion diffusion model on CPU.

Usage:
    # Train on the bundled fingerspelling lexicons (works with zero downloads)
    python train_diffusion.py --epochs 200

    # Train on a downloaded word-level lexicon as well (strongly recommended)
    python train_diffusion.py --lexicon ./lexicon --epochs 400

The checkpoint lands at ./checkpoints/diffusion/model.pt and is picked up
automatically by MOTION_BACKEND=diffusion.

Realistic expectations: with only the bundled fingerspelling alphabets (~600
samples, 179 glosses) the model learns letter handshapes but has no word-level
vocabulary and will not produce fluent signing. Download a real lexicon for
anything beyond a pipeline demonstration.
"""
import argparse
import json
import logging
import os
import time

import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset

from app.services.diffusion.data import (
    FEAT_DIM,
    SEQ_LEN,
    build_vocab,
    compute_stats,
    load_dataset,
)
from app.services.diffusion.model import GaussianDiffusion, MotionDenoiser

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("train")


class MotionDataset(Dataset):
    def __init__(self, samples, vocab, mean, std):
        self.x = np.stack([(s.motion - mean) / std for s in samples]).astype(np.float32)
        self.y = np.array([vocab.get(s.gloss, 0) for s in samples], dtype=np.int64)

    def __len__(self):
        return len(self.y)

    def __getitem__(self, i):
        return torch.from_numpy(self.x[i]), int(self.y[i])


def default_lexicons():
    """Always include the bundled fingerspelling lexicon so training works
    with no downloads at all."""
    dirs = []
    try:
        import spoken_to_signed
        fs = os.path.join(os.path.dirname(spoken_to_signed.__file__),
                          "assets", "fingerspelling_lexicon")
        if os.path.isdir(fs):
            dirs.append(fs)
    except ImportError:
        logger.warning("spoken_to_signed not installed — no bundled lexicon available")
    return dirs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lexicon", action="append", default=[],
                    help="Extra lexicon directory (repeatable)")
    ap.add_argument("--epochs", type=int, default=200)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--d-model", type=int, default=256)
    ap.add_argument("--layers", type=int, default=4)
    ap.add_argument("--diffusion-steps", type=int, default=200)
    ap.add_argument("--smooth-weight", type=float, default=1.0,
                    help="Weight on the temporal velocity/acceleration loss. "
                         "0 disables it; ~1.0 substantially reduces output jitter.")
    ap.add_argument("--cond-drop-prob", type=float, default=0.15,
                    help="Probability of dropping the gloss label (enables CFG)")
    ap.add_argument("--out", default="./checkpoints/diffusion")
    ap.add_argument("--threads", type=int, default=0, help="torch CPU threads (0 = auto)")
    args = ap.parse_args()

    if args.threads > 0:
        torch.set_num_threads(args.threads)

    lexicons = default_lexicons() + args.lexicon
    if not lexicons:
        raise SystemExit("No lexicons found. Install spoken-to-signed or pass --lexicon.")

    logger.info("Loading dataset from: %s", lexicons)
    samples = load_dataset(lexicons)
    if len(samples) < 8:
        raise SystemExit(f"Only {len(samples)} samples found — not enough to train.")

    vocab = build_vocab(samples)
    mean, std = compute_stats(samples)
    logger.info("Dataset: %d samples | %d glosses", len(samples), len(vocab))

    ds = MotionDataset(samples, vocab, mean, std)
    dl = DataLoader(ds, batch_size=args.batch_size, shuffle=True, drop_last=False)

    device = "cpu"
    model = MotionDenoiser(
        feat_dim=FEAT_DIM, seq_len=SEQ_LEN, vocab_size=len(vocab),
        d_model=args.d_model, n_layers=args.layers,
    ).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    logger.info("Model: %.2fM parameters", n_params / 1e6)

    diffusion = GaussianDiffusion(num_steps=args.diffusion_steps, device=device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)

    os.makedirs(args.out, exist_ok=True)
    best = float("inf")
    t_start = time.time()

    for epoch in range(1, args.epochs + 1):
        model.train()
        total, nb = 0.0, 0
        for x, y in dl:
            x, y = x.to(device), y.to(device)
            # Classifier-free guidance: randomly drop the condition
            if args.cond_drop_prob > 0:
                drop = torch.rand(y.shape, device=device) < args.cond_drop_prob
                y = torch.where(drop, torch.zeros_like(y), y)

            loss = diffusion.loss(model, x, y, smooth_weight=args.smooth_weight)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            total += loss.item()
            nb += 1
        sched.step()
        avg = total / max(nb, 1)

        if epoch % 10 == 0 or epoch == 1:
            logger.info("epoch %4d/%d | loss %.4f | %.1fs elapsed",
                        epoch, args.epochs, avg, time.time() - t_start)

        if avg < best:
            best = avg
            torch.save({
                "model_state": model.state_dict(),
                "vocab": vocab,
                "mean": mean, "std": std,
                "config": {
                    "feat_dim": FEAT_DIM, "seq_len": SEQ_LEN,
                    "vocab_size": len(vocab), "d_model": args.d_model,
                    "n_layers": args.layers, "diffusion_steps": args.diffusion_steps,
                },
                "train_info": {
                    "samples": len(samples), "epochs": epoch,
                    "best_loss": best, "lexicons": lexicons,
                    "smooth_weight": args.smooth_weight,
                },
            }, os.path.join(args.out, "model.pt"))

    with open(os.path.join(args.out, "vocab.json"), "w", encoding="utf-8") as f:
        json.dump(vocab, f, indent=2)

    logger.info("Done in %.1fs. Best loss %.4f -> %s/model.pt",
                time.time() - t_start, best, args.out)
    logger.info("Run with: MOTION_BACKEND=diffusion uvicorn main:app")


if __name__ == "__main__":
    main()
