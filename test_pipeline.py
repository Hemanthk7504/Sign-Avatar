import os
import sys
import numpy as np

print("--- 1. Testing Audio Pipeline ---")
from app.services.speech_to_text import _to_wav, _pcm_to_wav
pcm = b"\x00\x00" * 8000
wav = _pcm_to_wav(pcm, sample_rate=16000, channels=1)
assert wav.startswith(b"RIFF"), "WAV header missing from PCM conversion"
pass_through = _to_wav(wav, "audio/wav")
assert pass_through == wav, "Direct WAV pass-through failed"
print("OK audio pipeline verified")

print("\n--- 2. Testing Text-to-Gloss & Non-Manual Tagging ---")
from app.services.text_to_gloss import text_to_gloss
tokens = text_to_gloss("Where is the hospital?")
assert len(tokens) > 0, "No tokens produced"
wh_tokens = [t for t in tokens if "furrowed_brow" in t.non_manual]
assert len(wh_tokens) > 0, "WH-question non-manual tag (furrowed_brow) missing"
print("OK gloss tokens:", [t.gloss for t in tokens])
print("OK non-manual markers:", tokens[0].non_manual)

print("\n--- 3. Testing Diffusion Motion Streaming Generator ---")
from app.services.diffusion_adapter import diffusion_backend, landmarks_to_avatar_joints
assert diffusion_backend.is_available(), "Diffusion backend not available"

gen = diffusion_backend.stream_generate_landmarks("hello", variant="ASL", style="expressive")
tag, meta = next(gen)
assert tag == "meta", "First generator event must be meta"
assert meta["format"] == "landmarks", "Format must be landmarks"
assert meta["num_points"] == 66, "Point count must be 66"
assert len(meta["components"]) == 4, "Must have 4 body components"
print("OK stream metadata: format =", meta["format"], "fps =", meta["fps"], "components =", len(meta["components"]))

chunks = list(gen)
assert len(chunks) > 0, "No frame chunks yielded by generator"
first_chunk = chunks[0][1]
assert "frames" in first_chunk, "Chunk missing frames"
assert len(first_chunk["frames"][0]) == 66, "Each frame must have 66 points"
print("OK chunks received:", len(chunks), "First chunk frames:", len(first_chunk["frames"]))

joints = landmarks_to_avatar_joints(np.array(first_chunk["frames"][0]))
assert "joints" in joints, "Kinematic solver missing joints"
print("OK kinematic retargeting verified")

print("\n--- 4. Testing Evaluation Suite ---")
from app.services.evaluation import study
from app.services.evaluation.metrics import average_position_error, mean_jerk, dtw_distance, diversity

p = study.new_participant("certified_interpreter", 5.0)
r = study.record_response(
    p["participant_id"], p["role"], "hi", "diffusion", "ASL", "hi",
    {"comprehension": 5, "naturalness": 4, "grammaticality": 5},
    path="./data/test_eval.jsonl"
)
summary = study.summarize(path="./data/test_eval.jsonl")
assert summary["n"] == 1, "Summary count mismatch"
print("OK human study logging verified")
if os.path.exists("./data/test_eval.jsonl"):
    os.remove("./data/test_eval.jsonl")

print("\n==============================================")
print("ALL INTEGRATION OBJECTIVES VERIFIED SUCCESSFUL!")
print("==============================================")
