import logging

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthenticatedUser, get_current_user
from app.database import get_db
from app.models.db_models import Profile
from app.models.schemas import AuthMeResponse, ProfileRead

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/me", response_model=AuthMeResponse)
async def get_me(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AuthMeResponse:
    result = await db.execute(select(Profile).where(Profile.id == current_user.id))
    profile = result.scalar_one_or_none()
    if profile is None:
        profile = Profile(id=current_user.id, email=current_user.email or "")
        db.add(profile)
        await db.commit()
        await db.refresh(profile)
        logger.info("profile_created")
    return AuthMeResponse(user=ProfileRead.model_validate(profile))
