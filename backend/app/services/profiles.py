"""Idempotent creation of per-user rows that the first requests after signup race to create."""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import BusinessSettings, Profile


async def ensure_profile(db: AsyncSession, user_id: str, email: str | None) -> Profile:
    """Return the user's profile, creating it if needed.

    Right after email confirmation the app sends several requests at once, so two of them
    can both see "no profile" and try to insert. ON CONFLICT DO NOTHING makes that safe.
    """
    await db.execute(
        insert(Profile)
        .values(id=user_id, email=email or "")
        .on_conflict_do_nothing(index_elements=[Profile.id])
    )
    await db.commit()
    return (await db.execute(select(Profile).where(Profile.id == user_id))).scalar_one()


async def ensure_business_settings(db: AsyncSession, user_id: str, email: str | None) -> BusinessSettings:
    """Return the user's settings row, creating it (and its profile) if needed."""
    existing = (
        await db.execute(select(BusinessSettings).where(BusinessSettings.user_id == user_id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    await ensure_profile(db, user_id, email)
    await db.execute(
        insert(BusinessSettings)
        .values(user_id=user_id)
        .on_conflict_do_nothing(constraint="uq_business_settings_user_id")
    )
    await db.commit()
    return (
        await db.execute(select(BusinessSettings).where(BusinessSettings.user_id == user_id))
    ).scalar_one()
