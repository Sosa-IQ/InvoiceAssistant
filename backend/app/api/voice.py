import asyncio
import json
import logging

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/voice", tags=["voice"])

_SPEECHMATICS_URL = "https://asr.api.speechmatics.com/v2"


class TranscriptResponse(BaseModel):
    transcript: str


async def _transcribe(audio_bytes: bytes, filename: str, content_type: str) -> str:
    """Submit audio to Speechmatics, poll until done, return plain-text transcript."""
    headers = {"Authorization": f"Bearer {settings.speechmatics_api_key}"}
    config = {
        "type": "transcription",
        "transcription_config": {
            "language": "auto",
        },
        # Auto-detect English vs Spanish, including mid-recording code-switching
        "language_identification_config": {
            "expected_languages": ["en", "es"],
        },
    }

    # Strip codec parameters so Speechmatics sees a clean MIME type
    # e.g. "audio/webm;codecs=opus" -> "audio/webm"
    ct = content_type.split(";")[0]

    async with httpx.AsyncClient(headers=headers, timeout=120.0) as client:
        # 1. Submit job — pass filename + content-type so Speechmatics detects format correctly
        r = await client.post(
            f"{_SPEECHMATICS_URL}/jobs",
            files={"data_file": (filename, audio_bytes, ct)},
            data={"config": json.dumps(config)},
        )
        r.raise_for_status()
        job_id = r.json()["id"]
        logger.info("Speechmatics job submitted: %s", job_id)

        # 2. Poll for completion (up to ~90 s)
        for _ in range(90):
            await asyncio.sleep(1)
            r = await client.get(f"{_SPEECHMATICS_URL}/jobs/{job_id}")
            r.raise_for_status()
            status = r.json()["job"]["status"]
            logger.debug("Job %s status: %s", job_id, status)
            if status == "done":
                break
            if status in ("rejected", "deleted", "expired"):
                raise ValueError(f"Speechmatics job ended with status: {status}")
        else:
            raise TimeoutError("Transcription job timed out after 90 seconds.")

        # 3. Fetch plain-text transcript
        r = await client.get(
            f"{_SPEECHMATICS_URL}/jobs/{job_id}/transcript",
            params={"format": "txt"},
        )
        r.raise_for_status()
        return r.text.strip()


@router.post("/transcribe", response_model=TranscriptResponse)
async def transcribe_audio(
    audio: UploadFile = File(...),
) -> TranscriptResponse:
    """
    Accept an audio recording and return a transcript via Speechmatics.
    Automatically detects English or Spanish, including mixed-language recordings.
    """
    if not settings.speechmatics_api_key:
        raise HTTPException(503, "SPEECHMATICS_API_KEY is not configured.")

    contents = await audio.read()
    if not contents:
        raise HTTPException(400, "Empty audio file.")

    filename = audio.filename or "recording.webm"
    content_type = audio.content_type or "audio/webm"
    logger.info("Transcribing audio: %s (%s, %d bytes)", filename, content_type, len(contents))

    try:
        transcript = await _transcribe(contents, filename, content_type)
        logger.info("Transcript: %.200s", transcript)
        return TranscriptResponse(transcript=transcript)
    except httpx.HTTPStatusError as exc:
        logger.error("Speechmatics HTTP error %s: %s", exc.response.status_code, exc.response.text)
        raise HTTPException(502, f"Speechmatics returned {exc.response.status_code}") from exc
    except Exception as exc:
        logger.error("Transcription failed: %s", exc)
        raise HTTPException(500, f"Transcription failed: {exc}") from exc
