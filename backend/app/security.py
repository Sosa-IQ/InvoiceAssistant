from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import SecurityEvent


async def enforce_rate_limit(
    db: AsyncSession,
    *,
    user_id: str,
    event_type: str,
    limit: int,
    window_seconds: int,
    request_id: str | None,
) -> None:
    """Apply a durable per-user limit and record an owner-scoped audit event."""
    if limit < 1 or window_seconds < 1:
        raise RuntimeError("Rate limit configuration must be positive.")

    lock_key = f"rate:{user_id}:{event_type}"
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": lock_key},
    )
    cutoff = datetime.now(UTC) - timedelta(seconds=window_seconds)
    used = await db.scalar(
        select(func.count(SecurityEvent.id)).where(
            SecurityEvent.user_id == user_id,
            SecurityEvent.event_type == event_type,
            SecurityEvent.outcome == "allowed",
            SecurityEvent.created_at >= cutoff,
        )
    )
    blocked = int(used or 0) >= limit
    db.add(
        SecurityEvent(
            user_id=user_id,
            event_type=event_type,
            outcome="blocked" if blocked else "allowed",
            request_id=request_id,
        )
    )
    await db.commit()

    if blocked:
        raise HTTPException(
            status_code=429,
            detail="Request limit reached. Please retry later.",
            headers={"Retry-After": str(window_seconds)},
        )
