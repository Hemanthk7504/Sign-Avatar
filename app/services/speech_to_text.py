"""
Speech -> Text service.

Wraps `speech_recognition` so the pipeline accepts raw audio bytes (wav/webm/
ogg) captured from a browser microphone and returns a transcript. Kept as a
narrow, swappable interface (`transcribe_audio_bytes`) so a self-hosted model
(e.g. faster-whisper) can be dropped in later for offline/low-latency use
without changing the API or WebSocket layer.
"""
import io
import logging

import speech_recognition as sr
from pydub import AudioSegment

logger = logging.getLogger("sign_avatar.stt")

_recognizer = sr.Recognizer()
_recognizer.energy_threshold = 200
_recognizer.dynamic_energy_threshold = True


def _pcm_to_wav(pcm_bytes: bytes, sample_rate: int = 16000, channels: int = 1) -> bytes:
    """Pack raw 16-bit linear PCM bytes into standard RIFF WAV in pure Python."""
    import wave
    out = io.BytesIO()
    with wave.open(out, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)
    return out.getvalue()


def _to_wav(audio_bytes: bytes, content_type: str) -> bytes:
    """Normalize arbitrary browser-recorded audio (wav/pcm/webm/ogg/mp3) to WAV/PCM,
    which `speech_recognition` requires. Directly accepts WAV/PCM without ffmpeg."""
    # Direct pass-through if already RIFF WAV
    if audio_bytes.startswith(b"RIFF"):
        return audio_bytes

    # Raw PCM handling (e.g. from browser AudioWorklet or Web Audio API)
    if "pcm" in content_type or "raw" in content_type:
        return _pcm_to_wav(audio_bytes)

    fmt = "webm"
    if "ogg" in content_type:
        fmt = "ogg"
    elif "wav" in content_type:
        return audio_bytes
    elif "mp3" in content_type or "mpeg" in content_type:
        fmt = "mp3"

    try:
        from pydub import AudioSegment
        segment = AudioSegment.from_file(io.BytesIO(audio_bytes), format=fmt)
        out = io.BytesIO()
        segment.export(out, format="wav")
        return out.getvalue()
    except Exception as exc:
        raise RuntimeError(
            f"Decoding compressed audio ({fmt}) requires ffmpeg on PATH. "
            f"Send linear PCM WAV to transcribe without ffmpeg: {exc}"
        ) from exc


def transcribe_audio_bytes(audio_bytes: bytes, content_type: str = "audio/webm") -> str:
    """
    Convert raw audio bytes into a text transcript.

    Raises:
        ValueError: if the audio could not be decoded or no speech was recognized.
    """
    if not audio_bytes or len(audio_bytes) <= 44:
        raise ValueError("Audio recording was empty. Please hold the button while speaking.")

    try:
        wav_bytes = _to_wav(audio_bytes, content_type)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Audio decode failed")
        raise ValueError(f"Could not decode audio ({content_type}): {exc}") from exc

    if not wav_bytes or len(wav_bytes) <= 44:
        raise ValueError("Audio recording was empty. Please hold the button while speaking.")

    with sr.AudioFile(io.BytesIO(wav_bytes)) as source:
        if source.DURATION < 0.30:
            raise ValueError("Audio clip was too short. Please hold the button while speaking.")
        audio = _recognizer.record(source)

    try:
        # Uses Google Web Speech API endpoint via SpeechRecognition.
        text = _recognizer.recognize_google(audio)
        return text
    except sr.UnknownValueError as exc:
        raise ValueError("Speech was not intelligible. Please speak clearly into your microphone.") from exc
    except sr.RequestError as exc:
        raise ValueError(f"Speech recognition service error: {exc}") from exc

