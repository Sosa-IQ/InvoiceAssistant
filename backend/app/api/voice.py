import asyncio
import json
import logging
import math
import struct
import wave
from io import BytesIO

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.billing import require_pro_entitlement
from app.auth import AuthenticatedUser
from app.config import settings
from app.database import get_db
from app.services.usage_service import consume_voice_seconds, ensure_voice_budget_before_call

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/voice", tags=["voice"])

_SPEECHMATICS_URL = "https://asr.api.speechmatics.com/v2"


class TranscriptResponse(BaseModel):
    transcript: str


def _estimate_audio_seconds(contents: bytes, content_type: str) -> int:
    """Best-effort duration estimate used for pre-checks and metering."""
    ct = (content_type or "").split(";")[0].lower()
    if ct in {"audio/wav", "audio/x-wav", "audio/wave"} or contents[:4] == b"RIFF":
        try:
            with wave.open(BytesIO(contents), "rb") as wf:
                frames = wf.getnframes()
                rate = wf.getframerate() or 1
                return max(1, int(math.ceil(frames / float(rate))))
        except Exception:
            pass
    # Fallback: assume ~16 kbps effective for compressed webm/opus voice notes.
    approx = max(1, int(math.ceil(len(contents) / 2000)))
    return min(approx, settings.voice_max_seconds_per_clip)


async def _transcribe(audio_bytes: bytes, filename: str, content_type: str) -> str:
    """Submit audio to Speechmatics, poll until done, return plain-text transcript."""
    headers = {"Authorization": f"Bearer {settings.speechmatics_api_key}"}
    config = {
        "type": "transcription",
        "transcription_config": {
            "language": "auto",
        },
        "language_identification_config": {
            "expected_languages": ["en", "es"],
        },
    }
    ct = content_type.split(";")[0]

    async with httpx.AsyncClient(headers=headers, timeout=120.0) as client:
        r = await client.post(
            f"{_SPEECHMATICS_URL}/jobs",
            files={"data_file": (filename, audio_bytes, ct)},
            data={"config": json.dumps(config)},
        )
        r.raise_for_status()
        job_id = r.json()["id"]
        logger.info("transcription_job_submitted")

        for _ in range(90):
            await asyncio.sleep(1)
            r = await client.get(f"{_SPEECHMATICS_URL}/jobs/{job_id}")
            r.raise_for_status()
            status = r.json()["job"]["status"]
            logger.debug("transcription_job_status_%s", status)
            if status == "done":
                break
            if status in ("rejected", "deleted", "expired"):
                raise ValueError(f"Speechmatics job ended with status: {status}")
        else:
            raise TimeoutError("Transcription job timed out after 90 seconds.")

        r = await client.get(
            f"{_SPEECHMATICS_URL}/jobs/{job_id}/transcript",
            params={"format": "txt"},
        )
        r.raise_for_status()
        return r.text.strip()


@router.post("/transcribe", response_model=TranscriptResponse)
async def transcribe_audio(
    request: Request,
    audio: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(require_pro_entitlement),
    db: AsyncSession = Depends(get_db),
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

    max_bytes = settings.voice_max_upload_mb * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(413, f"Audio must be at most {settings.voice_max_upload_mb} MB.")

    filename = audio.filename or "recording.webm"
    content_type = audio.content_type or "audio/webm"
    estimate = _estimate_audio_seconds(contents, content_type)
    if estimate > settings.voice_max_seconds_per_clip:
        raise HTTPException(
            422,
            f"Recordings must be {settings.voice_max_seconds_per_clip} seconds or shorter.",
        )

    request_id = getattr(request.state, "request_id", None)
    await ensure_voice_budget_before_call(
        db,
        user_id=current_user.id,
        request_id=request_id,
        audio_seconds_estimate=estimate,
    )

    logger.info("transcription_started")
    try:
        transcript = await _transcribe(contents, filename, content_type)
        await consume_voice_seconds(
            db,
            user_id=current_user.id,
            audio_seconds=estimate,
            request_id=request_id,
        )
        logger.info("transcription_completed")
        return TranscriptResponse(transcript=transcript)
    except httpx.HTTPStatusError as exc:
        logger.error("transcription_provider_failed")
        raise HTTPException(502, "Transcription provider failed.") from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("transcription_failed", extra={"exception_type": type(exc).__name__})
        raise HTTPException(500, "Transcription failed.") from exc
