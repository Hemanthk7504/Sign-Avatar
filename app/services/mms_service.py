"""
MMS (Multimodal SignStream) Mocap Synthesis Service.
Interfaces with DFKI MMS-Player and Blender 4.2 LTS to generate
high-fidelity, baked skeletal human motion capture animations for 3D avatars.
"""

import hashlib
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger("sign_avatar.services.mms")

BASE_DIR = Path(__file__).resolve().parent.parent.parent
BLENDER_EXE = BASE_DIR / "tools" / "blender-4.2.23-windows-x64" / "blender.exe"
MMS_DIR = BASE_DIR / "mms_player"
MMS_MAIN_PY = MMS_DIR / "main.py"
DICTIONARY_DIR = MMS_DIR / "dictionary" / "DictionaryGeneration-deploy-260828"
FRONTEND_ANIM_DIR = BASE_DIR / "frontend" / "public" / "models" / "animations"
STATIC_ANIM_DIR = BASE_DIR / "static" / "animations"

FRONTEND_ANIM_DIR.mkdir(parents=True, exist_ok=True)
STATIC_ANIM_DIR.mkdir(parents=True, exist_ok=True)


def is_mms_available() -> bool:
    """Check if Blender and the sign dictionary are properly configured."""
    return (
        BLENDER_EXE.is_file()
        and MMS_MAIN_PY.is_file()
        and DICTIONARY_DIR.is_dir()
    )


def text_to_mms_rows(text: str) -> List[str]:
    """Convert an input string into MMS sign table rows using available fingerspelling and gestures."""
    clean_text = "".join(ch for ch in text.upper() if ch.isalpha() or ch.isspace())
    tokens = clean_text.split()
    
    rows = [
        "maingloss,framestart,frameend,duration,transition,domgloss,ndomgloss",
        "gest:PAUSENPOSITION,0,0,100%,0.25,,",
    ]
    
    for word_idx, word in enumerate(tokens):
        for letter in word:
            # Check if letter blend exists
            letter_blend = DICTIONARY_DIR / "fa" / "trimmed" / f"{letter}.blend"
            if letter_blend.is_file():
                rows.append(f"fa:{letter},0,0,100%,0.35,,")
            else:
                logger.warning(f"No mocap blend for letter '{letter}'")
                
        # Brief pause between words
        if word_idx < len(tokens) - 1:
            rows.append("<HOLD>,0,0,0.3,0.15,,")
            
    rows.append("gest:PAUSENPOSITION,0,0,100%,0.3,,")
    return rows


def synthesize_mms_animation(text: str, force_recompute: bool = False) -> Dict[str, str]:
    """
    Synthesize human mocap animation GLB from text using MMS-Player.
    Returns metadata and model_url for Three.js.
    """
    if not is_mms_available():
        raise RuntimeError("MMS-Player or Blender 4.2 LTS not available on this server.")

    # Unique cache key for text
    hash_key = hashlib.md5(text.strip().upper().encode("utf-8")).hexdigest()[:12]
    filename = f"mms_{hash_key}.glb"
    dest_frontend = FRONTEND_ANIM_DIR / filename
    dest_static = STATIC_ANIM_DIR / filename

    public_url = f"/models/animations/{filename}"

    if not force_recompute and dest_frontend.is_file():
        logger.info(f"Returning cached MMS mocap animation: {public_url}")
        return {
            "status": "cached",
            "model_url": public_url,
            "filename": filename,
            "text": text,
        }

    logger.info(f"Synthesizing new MMS mocap animation for: '{text}'...")

    with tempfile.TemporaryDirectory(prefix="mms_syn_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        mms_csv = tmp_path / "sequence.mms.csv"
        out_fbx = tmp_path / "output.fbx"
        out_glb = tmp_path / "output.glb"

        rows = text_to_mms_rows(text)
        with open(mms_csv, "w", encoding="utf-8") as f:
            f.write("\n".join(rows) + "\n")

        # Step 1: Run MMS-Player in Blender to bake animation to FBX
        cmd_mms = [
            str(BLENDER_EXE),
            "-b",
            "-P", str(MMS_MAIN_PY),
            "--",
            "--source-mms-file", str(mms_csv),
            "--dictionary-dir", str(DICTIONARY_DIR),
            "--use-relative-time",
            "--export-fbx", str(out_fbx),
        ]

        logger.info("Executing MMS-Player pipeline...")
        proc_mms = subprocess.run(
            cmd_mms,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=120,
            check=False,
        )

        if not out_fbx.is_file():
            logger.error(f"MMS-Player failed to produce FBX: {proc_mms.stdout}\n{proc_mms.stderr}")
            raise RuntimeError(f"MMS-Player failed to produce FBX. Exit code: {proc_mms.returncode}")

        # Step 2: Convert FBX to GLB with embedded skeletal animations
        convert_py = (
            f"import bpy\n"
            f"bpy.ops.import_scene.fbx(filepath=r'{str(out_fbx)}')\n"
            f"bpy.ops.export_scene.gltf(filepath=r'{str(out_glb)}', export_format='GLB')\n"
        )

        cmd_convert = [
            str(BLENDER_EXE),
            "-b",
            "--python-expr", convert_py,
        ]

        logger.info("Converting FBX to GLB...")
        proc_conv = subprocess.run(
            cmd_convert,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=60,
            check=False,
        )

        if not out_glb.is_file():
            logger.error(f"GLTF conversion failed: {proc_conv.stdout}\n{proc_conv.stderr}")
            raise RuntimeError(f"GLTF conversion failed. Exit code: {proc_conv.returncode}")

        # Step 3: Copy to public web directories
        shutil.copy2(out_glb, dest_frontend)
        shutil.copy2(out_glb, dest_static)
        logger.info(f"MMS animation generated successfully: {dest_frontend}")

    return {
        "status": "generated",
        "model_url": public_url,
        "filename": filename,
        "text": text,
    }
