"""Token/voice metering: monthly included allotment + rolling Pro-only packs."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from calendar import monthrange

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.db_models import Subscription, UsageEvent, UsagePackCredit
from app.security import enforce_rate_limit

logger = logging.getLogger(__name__)

_ACTIVE = frozenset({"active", "trialing"})
FEATURE_AI = "ai_text"
FEATURE_VOICE = "voice"
PACK_AI = "ai_tokens"
PACK_VOICE = "voice_seconds"


@dataclass(frozen=True)
class UsageSnapshot:
    pro_entitled: bool
    period_start: datetime
    period_end: datetime
    ai_tokens_included: int
    ai_tokens_used: int
    ai_tokens_pack_remaining: int
    ai_tokens_remaining: int
    ai_usage_ratio: float
    voice_seconds_included: int
    voice_seconds_used: int
    voice_seconds_pack_remaining: int
    voice_seconds_remaining: int
    voice_usage_ratio: float
    packs_frozen: bool


def is_pro_entitled(row: Subscription | None) -> bool:
    return bool(row and row.plan == "pro" and row.status in _ACTIVE)


def period_bounds(row: Subscription | None, *, now: datetime | None = None) -> tuple[datetime, datetime]:
    """Billing period when known; otherwise calendar month in UTC."""
    now = now or datetime.now(UTC)
    if row and row.current_period_end is not None:
        end = row.current_period_end
        if end.tzinfo is None:
            end = end.replace(tzinfo=UTC)
        # Stripe periods are typically one month; without period_start we
        # approximate a month window ending at current_period_end.
        start = end - timedelta(days=31)
        if start <= now < end:
            return start, end
    start = datetime(now.year, now.month, 1, tzinfo=UTC)
    last_day = monthrange(now.year, now.month)[1]
    end = datetime(now.year, now.month, last_day, 23, 59, 59, tzinfo=UTC) + timedelta(seconds=1)
    return start, end


def _ratio(used: int, included: int) -> float:
    if included <= 0:
        return 1.0 if used > 0 else 0.0
    return min(1.0, max(0.0, used / included))


def estimate_ai_cost_micros(tokens_in: int, tokens_out: int) -> int:
    """Rough gpt-4o-mini estimate in microdollars (1e-6 USD)."""
    # $0.15 / 1M in, $0.60 / 1M out → micros per token
    return int(tokens_in * 0.15 + tokens_out * 0.60)


def estimate_voice_cost_micros(audio_seconds: int) -> int:
    """Conservative Speechmatics-class estimate (~$0.30 / audio hour)."""
    return int(audio_seconds * (0.30 * 1_000_000 / 3600))


async def _sum_period(
    db: AsyncSession,
    *,
    user_id: str,
    feature: str,
    period_start: datetime,
    period_end: datetime,
) -> tuple[int, int]:
    """Return (tokens_total, audio_seconds_total) for feature in period."""
    row = (
        await db.execute(
            select(
                func.coalesce(func.sum(UsageEvent.tokens_in + UsageEvent.tokens_out), 0),
                func.coalesce(func.sum(UsageEvent.audio_seconds), 0),
            ).where(
                UsageEvent.user_id == user_id,
                UsageEvent.feature == feature,
                UsageEvent.created_at >= period_start,
                UsageEvent.created_at < period_end,
            )
        )
    ).one()
    return int(row[0] or 0), int(row[1] or 0)


async def _pack_remaining(db: AsyncSession, *, user_id: str, pack_kind: str) -> int:
    if pack_kind == PACK_AI:
        col = UsagePackCredit.tokens_remaining
    else:
        col = UsagePackCredit.voice_seconds_remaining
    total = await db.scalar(
        select(func.coalesce(func.sum(col), 0)).where(
            UsagePackCredit.user_id == user_id,
            UsagePackCredit.pack_kind == pack_kind,
        )
    )
    return int(total or 0)


async def _global_daily_cost_micros(db: AsyncSession) -> int:
    cutoff = datetime.now(UTC) - timedelta(days=1)
    total = await db.scalar(
        select(func.coalesce(func.sum(UsageEvent.estimated_cost_micros), 0)).where(
            UsageEvent.created_at >= cutoff
        )
    )
    return int(total or 0)


async def assert_global_budget(db: AsyncSession) -> None:
    used = await _global_daily_cost_micros(db)
    budget_micros = settings.global_daily_ai_budget_cents * 10_000
    if used >= budget_micros:
        logger.error("global_ai_budget_exhausted", extra={"used_micros": used})
        raise HTTPException(503, "AI features are temporarily unavailable. Please try again later.")


async def get_usage_snapshot(db: AsyncSession, user_id: str) -> UsageSnapshot:
    sub = (
        await db.execute(select(Subscription).where(Subscription.user_id == user_id))
    ).scalar_one_or_none()
    entitled = is_pro_entitled(sub)
    period_start, period_end = period_bounds(sub)
    ai_used, _ = await _sum_period(
        db, user_id=user_id, feature=FEATURE_AI, period_start=period_start, period_end=period_end
    )
    _, voice_used = await _sum_period(
        db, user_id=user_id, feature=FEATURE_VOICE, period_start=period_start, period_end=period_end
    )
    pack_ai = await _pack_remaining(db, user_id=user_id, pack_kind=PACK_AI)
    pack_voice = await _pack_remaining(db, user_id=user_id, pack_kind=PACK_VOICE)
    included_ai = settings.ai_monthly_token_limit if entitled else 0
    included_voice = settings.voice_monthly_seconds if entitled else 0
    # Packs only spendable while Pro; balance is still reported (frozen).
    spendable_pack_ai = pack_ai if entitled else 0
    spendable_pack_voice = pack_voice if entitled else 0
    ai_included_remaining = max(0, included_ai - ai_used)
    voice_included_remaining = max(0, included_voice - voice_used)
    return UsageSnapshot(
        pro_entitled=entitled,
        period_start=period_start,
        period_end=period_end,
        ai_tokens_included=included_ai,
        ai_tokens_used=ai_used,
        ai_tokens_pack_remaining=pack_ai,
        ai_tokens_remaining=ai_included_remaining + spendable_pack_ai,
        ai_usage_ratio=_ratio(ai_used, included_ai) if entitled else 0.0,
        voice_seconds_included=included_voice,
        voice_seconds_used=voice_used,
        voice_seconds_pack_remaining=pack_voice,
        voice_seconds_remaining=voice_included_remaining + spendable_pack_voice,
        voice_usage_ratio=_ratio(voice_used, included_voice) if entitled else 0.0,
        packs_frozen=bool(pack_ai or pack_voice) and not entitled,
    )


async def _debit_packs(
    db: AsyncSession,
    *,
    user_id: str,
    pack_kind: str,
    amount: int,
) -> None:
    if amount <= 0:
        return
    remaining_need = amount
    rows = (
        await db.execute(
            select(UsagePackCredit)
            .where(
                UsagePackCredit.user_id == user_id,
                UsagePackCredit.pack_kind == pack_kind,
            )
            .order_by(UsagePackCredit.created_at.asc())
            .with_for_update()
        )
    ).scalars().all()
    for row in rows:
        if remaining_need <= 0:
            break
        if pack_kind == PACK_AI:
            available = int(row.tokens_remaining)
            take = min(available, remaining_need)
            row.tokens_remaining = available - take
        else:
            available = int(row.voice_seconds_remaining)
            take = min(available, remaining_need)
            row.voice_seconds_remaining = available - take
        remaining_need -= take
        row.updated_at = datetime.now(UTC)
    if remaining_need > 0:
        raise HTTPException(429, "Usage limit reached for this feature.")


async def ensure_ai_budget_before_call(
    db: AsyncSession,
    *,
    user_id: str,
    request_id: str | None,
) -> None:
    await assert_global_budget(db)
    await enforce_rate_limit(
        db,
        user_id=user_id,
        event_type="invoice.generate",
        limit=settings.invoice_generation_limit,
        window_seconds=settings.invoice_generation_window_seconds,
        request_id=request_id,
    )
    if not settings.billing_enforcement_enabled:
        return
    snap = await get_usage_snapshot(db, user_id)
    if not snap.pro_entitled:
        raise HTTPException(402, "A Pro subscription is required for this feature.")
    if snap.ai_tokens_remaining < 1:
        raise HTTPException(
            429,
            "Monthly AI usage limit reached. Buy a top-up pack or wait until your plan renews.",
        )


async def ensure_voice_budget_before_call(
    db: AsyncSession,
    *,
    user_id: str,
    request_id: str | None,
    audio_seconds_estimate: int,
) -> None:
    await assert_global_budget(db)
    await enforce_rate_limit(
        db,
        user_id=user_id,
        event_type="voice.transcribe",
        limit=settings.voice_hourly_request_limit,
        window_seconds=settings.voice_hourly_window_seconds,
        request_id=request_id,
    )
    if not settings.billing_enforcement_enabled:
        return
    snap = await get_usage_snapshot(db, user_id)
    if not snap.pro_entitled:
        raise HTTPException(402, "A Pro subscription is required for this feature.")
    if audio_seconds_estimate > snap.voice_seconds_remaining:
        raise HTTPException(
            429,
            "Monthly voice usage limit reached. Buy a top-up pack or wait until your plan renews.",
        )


async def consume_ai_tokens(
    db: AsyncSession,
    *,
    user_id: str,
    tokens_in: int,
    tokens_out: int,
    request_id: str | None,
) -> None:
    total = max(0, tokens_in) + max(0, tokens_out)
    if settings.billing_enforcement_enabled:
        snap = await get_usage_snapshot(db, user_id)
        if not snap.pro_entitled:
            raise HTTPException(402, "A Pro subscription is required for this feature.")
        if total > snap.ai_tokens_remaining:
            raise HTTPException(
                429,
                "Monthly AI usage limit reached. Upgrade usage with a top-up pack or wait until your plan renews.",
            )
        included_remaining = max(0, snap.ai_tokens_included - snap.ai_tokens_used)
        pack_portion = max(0, total - included_remaining)
        if pack_portion:
            await _debit_packs(db, user_id=user_id, pack_kind=PACK_AI, amount=pack_portion)
    db.add(
        UsageEvent(
            user_id=user_id,
            feature=FEATURE_AI,
            tokens_in=max(0, tokens_in),
            tokens_out=max(0, tokens_out),
            audio_seconds=0,
            estimated_cost_micros=estimate_ai_cost_micros(tokens_in, tokens_out),
            request_id=request_id,
        )
    )
    await db.commit()


async def consume_voice_seconds(
    db: AsyncSession,
    *,
    user_id: str,
    audio_seconds: int,
    request_id: str | None,
) -> None:
    seconds = max(0, audio_seconds)
    if settings.billing_enforcement_enabled:
        snap = await get_usage_snapshot(db, user_id)
        if not snap.pro_entitled:
            raise HTTPException(402, "A Pro subscription is required for this feature.")
        if seconds > snap.voice_seconds_remaining:
            raise HTTPException(
                429,
                "Monthly voice usage limit reached. Upgrade usage with a top-up pack or wait until your plan renews.",
            )
        included_remaining = max(0, snap.voice_seconds_included - snap.voice_seconds_used)
        pack_portion = max(0, seconds - included_remaining)
        if pack_portion:
            await _debit_packs(db, user_id=user_id, pack_kind=PACK_VOICE, amount=pack_portion)
    db.add(
        UsageEvent(
            user_id=user_id,
            feature=FEATURE_VOICE,
            tokens_in=0,
            tokens_out=0,
            audio_seconds=seconds,
            estimated_cost_micros=estimate_voice_cost_micros(seconds),
            request_id=request_id,
        )
    )
    await db.commit()


async def credit_pack_from_checkout(
    db: AsyncSession,
    *,
    user_id: str,
    pack_kind: str,
    checkout_session_id: str,
    payment_intent_id: str | None,
) -> None:
    """Idempotently credit a purchased pack. Balance rolls until used."""
    existing = await db.scalar(
        select(UsagePackCredit.id).where(
            UsagePackCredit.stripe_checkout_session_id == checkout_session_id
        )
    )
    if existing is not None:
        return
    if pack_kind == PACK_AI:
        tokens = settings.ai_pack_tokens
        voice = 0
    elif pack_kind == PACK_VOICE:
        tokens = 0
        voice = settings.voice_pack_seconds
    else:
        logger.warning("usage_pack_unknown_kind", extra={"pack_kind": pack_kind})
        return
    db.add(
        UsagePackCredit(
            user_id=user_id,
            pack_kind=pack_kind,
            tokens_remaining=tokens,
            voice_seconds_remaining=voice,
            stripe_checkout_session_id=checkout_session_id,
            stripe_payment_intent_id=payment_intent_id,
        )
    )


async def user_is_pro(db: AsyncSession, user_id: str) -> bool:
    if not settings.billing_enforcement_enabled:
        return True
    row = (
        await db.execute(select(Subscription).where(Subscription.user_id == user_id))
    ).scalar_one_or_none()
    return is_pro_entitled(row)
