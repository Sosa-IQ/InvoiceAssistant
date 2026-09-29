import asyncio
import logging
import math
import re
import struct
import wave
from io import BytesIO

import openai
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.billing import require_pro_entitlement
from app.auth import AuthenticatedUser
from app.config import settings
from app.database import get_db
from app.models.db_models import CatalogItem, Client
from app.services.openai_service import OpenAIService
from app.services.usage_service import consume_voice_seconds, ensure_voice_budget_before_call

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/voice", tags=["voice"])
openai_svc = OpenAIService()


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


_MAX_KEYWORDS = 100
_MAX_KEYWORD_CHARS = 80


async def _transcription_keywords(db: AsyncSession, user_id: str) -> list[str]:
    """This user's client names and catalog items, to bias recognition toward them."""
    clients = await db.execute(select(Client.name).where(Client.user_id == user_id).order_by(Client.name))
    catalog = await db.execute(
        select(CatalogItem.description).where(CatalogItem.user_id == user_id).order_by(CatalogItem.description)
    )
    keywords: list[str] = []
    for raw in [*clients.scalars(), *catalog.scalars()]:
        # The API requires one line per keyword without angle brackets.
        term = " ".join(re.sub(r"[<>]", " ", raw or "").split())[:_MAX_KEYWORD_CHARS].strip()
        if term and term not in keywords:
            keywords.append(term)
        if len(keywords) >= _MAX_KEYWORDS:
            break
    return keywords


@router.post("/transcribe", response_model=TranscriptResponse)
async def transcribe_audio(
    request: Request,
    audio: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(require_pro_entitlement),
    db: AsyncSession = Depends(get_db),
) -> TranscriptResponse:
    """
    Accept an audio recording and return a transcript via OpenAI gpt-transcribe.
    Detects the spoken language automatically, including mixed-language recordings.
    Translation to English happens later, when the AI drafts the invoice.
    """
    if not settings.openai_api_key:
        raise HTTPException(503, "OPENAI_API_KEY is not configured.")

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
        keywords = await _transcription_keywords(db, current_user.id)
        transcript = await asyncio.to_thread(openai_svc.transcribe, contents, filename, keywords)
        await consume_voice_seconds(
            db,
            user_id=current_user.id,
            audio_seconds=estimate,
            request_id=request_id,
        )
        logger.info("transcription_completed")
        return TranscriptResponse(transcript=transcript)
    except openai.APIError as exc:
        logger.error("transcription_provider_failed")
        raise HTTPException(502, "Transcription provider failed.") from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("transcription_failed", extra={"exception_type": type(exc).__name__})
        raise HTTPException(500, "Transcription failed.") from exc
