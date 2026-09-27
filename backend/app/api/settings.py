import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthenticatedUser, get_current_user
from app.database import get_db
from app.models.db_models import BusinessSettings
from app.models.schemas import BusinessSettingsRead, BusinessSettingsUpdate
from app.services.profiles import ensure_business_settings, ensure_profile

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/settings", tags=["settings"])


async def _get_or_create_for_user(db: AsyncSession, user: AuthenticatedUser) -> BusinessSettings:
    """Return the user's settings row, adopting a legacy unowned row or creating defaults."""
    result = await db.execute(select(BusinessSettings).where(BusinessSettings.user_id == user.id))
    row = result.scalar_one_or_none()
    if row is not None:
        return row

    legacy_result = await db.execute(
        select(BusinessSettings).where(BusinessSettings.user_id.is_(None)).order_by(BusinessSettings.id)
    )
    legacy_row = legacy_result.scalar_one_or_none()
    if legacy_row is not None:
        await ensure_profile(db, user.id, user.email)
        legacy_row.user_id = user.id
        await db.commit()
        await db.refresh(legacy_row)
        return legacy_row

    return await ensure_business_settings(db, user.id, user.email)


@router.get("", response_model=BusinessSettingsRead)
async def get_settings(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BusinessSettingsRead:
    """Return the authenticated user's business profile."""
    row = await _get_or_create_for_user(db, current_user)
    return BusinessSettingsRead.model_validate(row)


@router.put("", response_model=BusinessSettingsRead)
async def update_settings(
    body: BusinessSettingsUpdate,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BusinessSettingsRead:
    """Partial-update the business profile."""
    row = await _get_or_create_for_user(db, current_user)
    changes = body.model_dump(exclude_unset=True)
    if "onboarding_completed" in changes:
        # Stamp/clear the completion time server-side; clients cannot supply one.
        completed = changes.pop("onboarding_completed")
        row.onboarding_completed_at = datetime.now(timezone.utc) if completed else None
    for field, value in changes.items():
        setattr(row, field, value)
    row.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(row)
    logger.info("Business settings updated.")
    return BusinessSettingsRead.model_validate(row)
