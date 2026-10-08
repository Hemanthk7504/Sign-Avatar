"""
Real-time WebSocket endpoint.

Client -> Server:
    {"type": "config", "variant": "ASL", "style": "neutral"}
    {"type": "text", "text": "Hello, how are you?"}
    <binary frame>                       -- recorded microphone audio

Server -> Client:
    {"type": "session_ready", "config": {...}}
    {"type": "transcript", "text": "..."}
    {"type": "gloss", "tokens": [...]}
    {"type": "sequence_start", "format": "landmarks"|"joints", "fps": n,
     "backend": "...", "components": [...]}     -- components only for landmarks
    {"type": "frames", "seq": n, "final": bool, "frames": [...]}
    {"type": "sequence_end", "duration": 1.23}
    {"type": "error", "message": "..."}

Frames stream in small chunks as they're produced so the avatar starts moving
before the whole utterance is ready.
"""
import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import settings
from app.services.pipeline import generate_motion
from app.services.speech_to_text import transcribe_audio_bytes

logger = logging.getLogger("sign_avatar.ws")
router = APIRouter()


class SessionState:
    def __init__(self):
        self.variant = settings.DEFAULT_VARIANT
        self.style = "neutral"
        self.style_seed = None
        self.backend = settings.MOTION_BACKEND


import threading

async def _stream_motion(ws: WebSocket, text: str, state: SessionState):
    backend_to_use = getattr(state, "backend", settings.MOTION_BACKEND)
    # Check if diffusion streaming generator is available
    if backend_to_use == "diffusion":
        try:
            from app.services.diffusion_adapter import diffusion_backend, DiffusionUnavailable
            if diffusion_backend.is_available():
                queue = asyncio.Queue()
                loop = asyncio.get_running_loop()

                def _worker():
                    try:
                        for item in diffusion_backend.stream_generate_landmarks(
                            text, variant=state.variant, style=state.style, seed=state.style_seed
                        ):
                            loop.call_soon_threadsafe(queue.put_nowait, ("item", item))
                        loop.call_soon_threadsafe(queue.put_nowait, ("done", None))
                    except Exception as exc:
                        loop.call_soon_threadsafe(queue.put_nowait, ("error", exc))

                threading.Thread(target=_worker, daemon=True).start()

                total_frames_sent = 0
                fps = 25
                chunk_size = settings.STREAM_CHUNK_FRAMES

                while True:
                    kind, data = await queue.get()
                    if kind == "error":
                        raise data
                    if kind == "done":
                        break
                    
                    event_type, payload = data
                    if event_type == "meta":
                        fps = payload["fps"]
                        await ws.send_text(json.dumps({
                            "type": "gloss",
                            "tokens": payload.get("tokens", []),
                        }))
                        await ws.send_text(json.dumps({
                            "type": "sequence_start",
                            "format": payload["format"],
                            "fps": fps,
                            "backend": "diffusion",
                            "components": payload["components"],
                            "num_points": payload["num_points"],
                        }))
                    elif event_type == "chunk":
                        chunk_frames = payload["frames"]
                        for i in range(0, len(chunk_frames), chunk_size):
                            subchunk = chunk_frames[i:i + chunk_size]
                            total_frames_sent += len(subchunk)
                            is_final = payload.get("final", False) and (i + chunk_size >= len(chunk_frames))
                            await ws.send_text(json.dumps({
                                "type": "frames",
                                "seq": total_frames_sent // chunk_size,
                                "final": is_final,
                                "frames": subchunk,
                            }))
                            await asyncio.sleep(0)

                await ws.send_text(json.dumps({
                    "type": "sequence_end",
                    "duration": total_frames_sent / max(fps, 1),
                }))
                return
        except Exception as exc:
            logger.warning("Streaming diffusion generator failed (%s), falling back to standard pipeline", exc)

    # Fallback to standard batch pipeline
    payload = await asyncio.to_thread(
        generate_motion, text, state.variant, state.style, state.style_seed, backend_to_use
    )

    await ws.send_text(json.dumps({
        "type": "gloss",
        "tokens": payload.get("gloss_sequence", []),
    }))

    start_msg = {
        "type": "sequence_start",
        "format": payload["format"],
        "fps": payload["fps"],
        "backend": payload.get("backend", "unknown"),
    }
    if payload["format"] == "landmarks":
        start_msg["components"] = payload["components"]
        start_msg["num_points"] = payload["num_points"]
    await ws.send_text(json.dumps(start_msg))

    frames = payload["frames"]
    total = len(frames)
    if total == 0:
        await ws.send_text(json.dumps({"type": "sequence_end", "duration": 0.0}))
        return

    chunk_size = settings.STREAM_CHUNK_FRAMES
    for i in range(0, total, chunk_size):
        chunk = frames[i:i + chunk_size]
        await ws.send_text(json.dumps({
            "type": "frames",
            "seq": i // chunk_size,
            "final": (i + chunk_size) >= total,
            "frames": chunk,
        }))
        await asyncio.sleep(0)

    await ws.send_text(json.dumps({
        "type": "sequence_end",
        "duration": payload.get("duration", 0.0),
    }))



@router.websocket("/ws/generate")
async def generate_ws(ws: WebSocket):
    await ws.accept()
    state = SessionState()
    await ws.send_text(json.dumps({
        "type": "session_ready",
        "config": {
            "fps": settings.TARGET_FPS,
            "variant": state.variant,
            "style": state.style,
            "backend": settings.MOTION_BACKEND,
        },
    }))

    try:
        while True:
            message = await ws.receive()

            if message.get("type") == "websocket.disconnect":
                break

            if message.get("bytes") is not None:
                audio_bytes = message["bytes"]
                content_type = "audio/wav" if audio_bytes.startswith(b"RIFF") else "audio/webm"
                try:
                    transcript = await asyncio.to_thread(
                        transcribe_audio_bytes, audio_bytes, content_type
                    )
                except ValueError as exc:
                    await ws.send_text(json.dumps({"type": "error", "message": str(exc)}))
                    continue
                await ws.send_text(json.dumps({"type": "transcript", "text": transcript}))
                await _stream_motion(ws, transcript, state)
                continue

            if message.get("text") is not None:
                try:
                    data = json.loads(message["text"])
                except json.JSONDecodeError:
                    await ws.send_text(json.dumps({"type": "error", "message": "Invalid JSON"}))
                    continue

                mtype = data.get("type")

                if mtype == "config":
                    if data.get("variant"):
                        state.variant = data["variant"]
                    if data.get("style"):
                        state.style = data["style"]
                    if data.get("backend"):
                        state.backend = data["backend"]
                    if data.get("style_seed") is not None:
                        state.style_seed = data["style_seed"]
                    await ws.send_text(json.dumps({
                        "type": "session_ready",
                        "config": {
                            "fps": settings.TARGET_FPS,
                            "variant": state.variant,
                            "style": state.style,
                            "backend": state.backend,
                        },
                    }))

                elif mtype == "text":
                    text = (data.get("text") or "").strip()
                    if not text:
                        await ws.send_text(json.dumps({"type": "error", "message": "Empty text"}))
                        continue
                    try:
                        await _stream_motion(ws, text, state)
                    except Exception as exc:  # noqa: BLE001
                        logger.exception("Generation failed")
                        await ws.send_text(json.dumps({"type": "error", "message": str(exc)}))

                else:
                    await ws.send_text(json.dumps({
                        "type": "error", "message": f"Unknown message type '{mtype}'"
                    }))

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as exc:  # noqa: BLE001
        logger.exception("WebSocket session crashed")
        try:
            await ws.send_text(json.dumps({"type": "error", "message": f"Server error: {exc}"}))
        except Exception:  # noqa: BLE001
            pass
