import logging
from pathlib import Path

import stripe
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthenticatedUser, get_current_user
from app.config import settings
from app.database import get_db
from app.models.db_models import InvoiceRecord, Profile, Subscription
from app.models.schemas import AccountDeleteRequest, AuthMeResponse, ProfileRead
from app.services.stripe_service import stripe_service
from app.services.supabase_service import SupabaseService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

supabase_svc = SupabaseService()

# Subscriptions in these states can no longer bill, so there is nothing to cancel.
_FINISHED_SUBSCRIPTION_STATUSES = frozenset({"canceled", "incomplete_expired"})


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


async def _cancel_stripe_subscriptions(customer_id: str) -> None:
    try:
        subscriptions = await stripe_service.list_subscriptions_for_customer(customer_id)
    except stripe.InvalidRequestError as exc:
        if getattr(exc, "code", None) == "resource_missing":
            return
        raise
    for subscription in subscriptions:
        if subscription.get("status") not in _FINISHED_SUBSCRIPTION_STATUSES:
            await stripe_service.cancel_subscription(str(subscription["id"]))


def _remove_local_pdf(file_path: str | None) -> None:
    """Best-effort removal of a cached PDF, only inside the app's data directory."""
    if not file_path:
        return
    path = Path(file_path).resolve()
    if not path.is_relative_to(settings.data_dir.resolve()):
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("account_delete_local_pdf_failed")


@router.delete("/account", status_code=204)
async def delete_account(
    payload: AccountDeleteRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Permanently delete the caller's account and everything it owns.

    Steps that could leave the user billed or leave files behind (Stripe, Storage) run
    first and abort the deletion on failure, so a retry is always safe. Deleting the
    Supabase Auth user last cascades through every app table.
    """
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise HTTPException(503, "Account deletion is not available right now.")

    profile = (await db.execute(select(Profile).where(Profile.id == current_user.id))).scalar_one_or_none()
    known_emails = {e.strip().lower() for e in (current_user.email, profile.email if profile else None) if e}
    if payload.confirm_email.strip().lower() not in known_emails:
        raise HTTPException(400, "The email you typed does not match your account.")

    subscription = (
        await db.execute(select(Subscription).where(Subscription.user_id == current_user.id))
    ).scalar_one_or_none()
    if subscription and subscription.stripe_customer_id and settings.stripe_secret_key:
        try:
            await _cancel_stripe_subscriptions(subscription.stripe_customer_id)
        except Exception as exc:
            logger.error("account_delete_stripe_failed", extra={"error_type": type(exc).__name__})
            raise HTTPException(
                502, "We could not cancel your subscription, so nothing was deleted. Please try again."
            ) from exc

    try:
        paths = await supabase_svc.list_object_paths(current_user.id)
        if paths:
            await supabase_svc.delete_objects(paths)
    except Exception as exc:
        logger.error("account_delete_storage_failed", extra={"error_type": type(exc).__name__})
        raise HTTPException(502, "We could not remove your stored files. Please try again.") from exc

    file_paths = (
        await db.execute(select(InvoiceRecord.file_path).where(InvoiceRecord.user_id == current_user.id))
    ).scalars().all()
    # Release the session before the cascade runs in Supabase, so no open transaction holds row locks.
    await db.rollback()
    for file_path in file_paths:
        _remove_local_pdf(file_path)

    try:
        await supabase_svc.delete_auth_user(current_user.id)
    except Exception as exc:
        logger.error("account_delete_auth_failed", extra={"error_type": type(exc).__name__})
        raise HTTPException(502, "We could not finish deleting your account. Please try again.") from exc

    logger.info("account_deleted")
