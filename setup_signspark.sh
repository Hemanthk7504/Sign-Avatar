#!/usr/bin/env bash
# Sets up the real, pretrained SignSparK model (ECCV 2026, Low et al., CVSSP
# University of Surrey) as this app's motion backend.
#
# What this does NOT do: it does not run inside a sandboxed CI/dev container
# without GPU + internet access to Hugging Face. Run this on the machine that
# will actually serve requests.
#
# License note: SignSparK's *code* is Apache-2.0. Its *checkpoints and data*
# are derived from CSL-Daily, How2Sign and BOBSL and are released for
# NON-COMMERCIAL RESEARCH USE ONLY, under those datasets' terms — read
# https://github.com/JianHe0628/SignSparK/blob/main/LICENSE and the dataset
# licenses before using this in anything beyond research/a course project.
set -euo pipefail

SIGNSPARK_DIR="${SIGNSPARK_DIR:-./signspark_src}"

echo "== 1/4: clone SignSparK =="
if [ ! -d "$SIGNSPARK_DIR" ]; then
  git clone https://github.com/JianHe0628/SignSparK.git "$SIGNSPARK_DIR"
else
  echo "Already cloned at $SIGNSPARK_DIR"
fi

echo "== 2/4: install SignSparK's dependencies =="
echo "   (PyTorch 2.10 / CUDA 12.8 by default — edit requirements.txt there for a different CUDA version)"
pip install -r "$SIGNSPARK_DIR/requirements.txt"

echo "== 3/4: download pretrained checkpoints (hand, body, face) =="
export SIGNSPARK_CKPT_DIR="${SIGNSPARK_CKPT_DIR:-$(pwd)/checkpoints}"
python "$SIGNSPARK_DIR/tools/download_models.py" --streams hand body face --dest "$SIGNSPARK_CKPT_DIR"

echo "== 4/4: done =="
cat <<EOF

Set these before starting this app's backend:

    export MOTION_BACKEND=signspark
    export SIGNSPARK_REPO_DIR=$(cd "$SIGNSPARK_DIR" && pwd)
    export SIGNSPARK_CKPT_DIR=${SIGNSPARK_CKPT_DIR}

    uvicorn main:app --host 0.0.0.0 --port 8000

Requirements to actually get real (not fallback) output:
  - A CUDA GPU with enough VRAM for a ~1.4B-param UNet (the app runs one
    stream at a time — hand, then body, then face — to keep peak VRAM down,
    but each is still a large model).
  - The checkpoints downloaded above (several GB total).
  - Only ASL and BSL variants are covered (How2Sign / BOBSL training data);
    ISL falls back to the procedural backend automatically.
  - Real, unconstrained free-text generation only (SignSparK's keyframe
    conditioning needs its "FAST" segmenter, which is embargoed until end of
    September 2026 — see app/services/signspark_adapter.py for details).

If any of this isn't set up, the app detects it and automatically falls back
to the built-in procedural motion generator — it never hard-fails.
EOF
