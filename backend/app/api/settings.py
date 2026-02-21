import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.db_models import BusinessSettings
from app.models.schemas import BusinessSettingsRead, BusinessSettingsUpdate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/settings", tags=["settings"])


async def _get_or_create(db: AsyncSession) -> BusinessSettings:
    """Return the single settings row, creating it with defaults if absent."""
    result = await db.execute(select(BusinessSettings).where(BusinessSettings.id == 1))
    row = result.scalar_one_or_none()
    if row is None:
        row = BusinessSettings(id=1)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


@router.get("", response_model=BusinessSettingsRead)
async def get_settings(db: AsyncSession = Depends(get_db)) -> BusinessSettingsRead:
    """Return the business profile (creates a blank row on first call)."""
    row = await _get_or_create(db)
    return BusinessSettingsRead.model_validate(row)


@router.put("", response_model=BusinessSettingsRead)
async def update_settings(
    body: BusinessSettingsUpdate,
    db: AsyncSession = Depends(get_db),
) -> BusinessSettingsRead:
    """Partial-update the business profile."""
    row = await _get_or_create(db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(row)
    logger.info("Business settings updated.")
    return BusinessSettingsRead.model_validate(row)
