import logging
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthenticatedUser, get_current_user
from app.config import settings
from app.database import get_db
from app.models.db_models import StripeWebhookEvent, Subscription
from app.models.schemas import (
    BillingPlanRead,
    BillingPlansResponse,
    BillingSessionResponse,
    BillingStatusRead,
    CheckoutSessionRequest,
    PackCheckoutRequest,
    UsageStatusRead,
)
from app.services.stripe_service import stripe_service
from app.services.usage_service import (
    PACK_AI,
    PACK_VOICE,
    credit_pack_from_checkout,
    get_usage_snapshot,
    is_pro_entitled,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/billing", tags=["billing"])
stripe_svc = stripe_service
_ACTIVE_STATUSES = frozenset({"active", "trialing"})
# A subscription is done for good only in these states. Every other Stripe status
# (past_due, incomplete, unpaid, ...) is a live subscription that must block a
# second Checkout and be managed through the billing portal instead.
_TERMINAL_SUBSCRIPTION_STATUSES = frozenset({"canceled", "incomplete_expired"})
_SUPPORTED_INTERVALS = frozenset({"month", "year"})
_SUBSCRIPTION_EVENTS = frozenset(
    {
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    }
)
# Stripe webhook payloads are small; bound the raw body before buffering so an
# unauthenticated caller cannot exhaust memory ahead of signature verification.
_MAX_WEBHOOK_BYTES = 1 * 1024 * 1024
# A Checkout idempotency key is reused only long enough to absorb process/HTTP
# retries, then rotated so a returning user is never handed a stale/expired
# session URL instead of a fresh one.
_CHECKOUT_KEY_TTL_SECONDS = 3600
# Stripe rejects a Checkout session whose ``expires_at`` is under 30 minutes out.
# A persisted key derives its session expiry from its creation time, so it is
# only reusable while that derived expiry still clears this floor.
_STRIPE_MIN_SESSION_LEAD_SECONDS = 30 * 60

_FREE_FEATURES = [
    "Create and edit invoices",
    "Manage clients and catalog items",
    "Export invoice PDFs",
    "Import past invoice PDFs",
]
_PRO_FEATURES = [
    "Email invoice delivery",
    "AI-assisted drafting and edits",
    "Voice input",
    "Automatic smart suggestions from your invoices",
]


def _require_stripe() -> None:
    if not settings.stripe_configured:
        raise HTTPException(503, "Billing is not configured yet.")


async def _get_subscription(db: AsyncSession, user_id: str) -> Subscription | None:
    result = await db.execute(select(Subscription).where(Subscription.user_id == user_id))
    return result.scalar_one_or_none()


async def _get_or_create_subscription(db: AsyncSession, user_id: str) -> Subscription:
    await db.execute(
        insert(Subscription)
        .values(user_id=user_id, plan="free", status="free")
        .on_conflict_do_nothing(index_elements=[Subscription.user_id])
    )
    await db.flush()
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == user_id)
        .with_for_update()
    )
    return result.scalar_one()


def _checkout_idempotency_key(row: Subscription) -> str:
    """Reuse a Checkout idempotency key across retries, rotating once stale.

    Reusing the key lets process/HTTP retries return the same session instead of
    creating duplicates. The key is rotated once the session it would open can no
    longer clear Stripe's 30-minute minimum lifetime, so a returning user is
    never handed (or rejected for) a session Stripe would consider too short.
    """
    now = datetime.now(timezone.utc)
    created = row.checkout_idempotency_created_at
    if row.checkout_idempotency_key and created is not None:
        derived_expiry = created + timedelta(seconds=_CHECKOUT_KEY_TTL_SECONDS)
        if derived_expiry - now >= timedelta(seconds=_STRIPE_MIN_SESSION_LEAD_SECONDS):
            return row.checkout_idempotency_key
    row.checkout_idempotency_key = uuid.uuid4().hex
    row.checkout_idempotency_created_at = now
    return row.checkout_idempotency_key


def _validated_checkout_url(url: str | None) -> str:
    """Ensure the provider handed back an https session URL before returning it."""
    parsed = urlsplit(url or "")
    if parsed.scheme != "https" or not parsed.netloc:
        logger.error("stripe_checkout_url_invalid")
        raise HTTPException(502, "Billing provider returned an invalid session URL.")
    return url  # type: ignore[return-value]


def _is_missing_stripe_customer_error(exc: BaseException) -> bool:
    """True when Stripe says the stored customer id no longer exists."""
    if not isinstance(exc, stripe.InvalidRequestError):
        return False
    code = getattr(exc, "code", None) or ""
    param = getattr(exc, "param", None) or ""
    message = str(exc) or ""
    if code == "resource_missing" and param == "customer":
        return True
    return "No such customer" in message


def _is_terminal_status(status: str) -> bool:
    return status in _TERMINAL_SUBSCRIPTION_STATUSES


def _clear_stale_stripe_customer(row: Subscription) -> None:
    """Drop a local customer mapping Stripe no longer recognizes.

    Leaves plan/status alone when still entitled (should be rare); clears Checkout
    fields so a replacement customer and session can be created cleanly.
    """
    logger.warning(
        "stripe_customer_missing_cleared",
        extra={"had_customer": bool(row.stripe_customer_id)},
    )
    row.stripe_customer_id = None
    # If we were not entitled, also drop any dangling subscription id so a
    # replacement Checkout can bind a fresh subscription without conflict.
    if row.plan != "pro" or row.status not in _ACTIVE_STATUSES:
        row.stripe_subscription_id = None
        row.stripe_price_id = None
        row.current_period_end = None
        row.cancel_at_period_end = False
    row.checkout_session_id = None
    row.checkout_session_expires_at = None
    row.checkout_idempotency_key = None
    row.checkout_idempotency_created_at = None
    row.updated_at = datetime.now(timezone.utc)


def _local_checkout_block(row: Subscription) -> str | None:
    """Reason to refuse Checkout for the row's current local state, or None.

    Any live (nonterminal) subscription blocks a second Checkout: active/trialing
    is already paid, and a recoverable status (past_due/incomplete/unpaid) must be
    fixed in the billing portal rather than by opening a fresh subscription.
    """
    if not row.stripe_subscription_id:
        return None
    if _is_terminal_status(row.status):
        return None
    if row.status in _ACTIVE_STATUSES:
        return "An active subscription already exists. Manage it in billing."
    return "A subscription that needs attention already exists. Manage it in billing."


def _session_targets_configured_price(session: dict, *, price_id: str | None = None) -> bool:
    """True when an open Checkout session is for a configured Pro price (or a specific one)."""
    items = (session.get("line_items") or {}).get("data") or []
    if len(items) != 1:
        return False
    sid = (items[0].get("price") or {}).get("id")
    if price_id is not None:
        return sid == price_id
    return sid in settings.configured_pro_price_ids


def _status_response(row: Subscription | None) -> BillingStatusRead:
    return BillingStatusRead(
        plan=row.plan if row else "free",
        status=row.status if row else "free",
        stripe_customer_id=row.stripe_customer_id if row else None,
        stripe_subscription_id=row.stripe_subscription_id if row else None,
        stripe_price_id=row.stripe_price_id if row else None,
        current_period_end=row.current_period_end if row else None,
        cancel_at_period_end=row.cancel_at_period_end if row else False,
        configured=settings.stripe_configured,
        enforcement_enabled=settings.billing_enforcement_enabled,
    )


def _free_plan(currency: str) -> BillingPlanRead:
    return BillingPlanRead(
        code="free",
        name="Free",
        price_cents=0,
        currency=currency,
        interval="month",
        features=_FREE_FEATURES,
    )


def _pro_price_is_valid(price: dict, *, expected_id: str, expected_interval: str) -> bool:
    if price.get("id") != expected_id:
        return False
    if price.get("active") is not True:
        return False
    recurring = price.get("recurring")
    if not isinstance(recurring, dict) or recurring.get("interval") != expected_interval:
        return False
    unit_amount = price.get("unit_amount")
    if not isinstance(unit_amount, int) or isinstance(unit_amount, bool) or unit_amount < 0:
        return False
    currency = price.get("currency")
    return isinstance(currency, str) and len(currency) == 3 and currency.isalpha()


async def _authoritative_pro_plan(*, price_id: str, expected_interval: str) -> BillingPlanRead:
    """Build a Pro plan card from Stripe, never from divergent env display values."""
    try:
        price = await stripe_svc.retrieve_price(price_id)
    except Exception as exc:
        logger.exception(
            "stripe_price_retrieve_failed", extra={"exception_type": type(exc).__name__}
        )
        raise HTTPException(502, "Billing plans are temporarily unavailable.") from exc
    if not _pro_price_is_valid(price, expected_id=price_id, expected_interval=expected_interval):
        logger.error("stripe_price_invalid", extra={"price_id": price_id})
        raise HTTPException(502, "The configured Pro price is not usable.")
    label = "Pro (yearly)" if expected_interval == "year" else "Pro"
    return BillingPlanRead(
        code="pro",
        name=label,
        price_cents=int(price["unit_amount"]),
        currency=str(price["currency"]).upper(),
        interval=expected_interval,  # type: ignore[arg-type]
        features=_PRO_FEATURES,
    )


@router.get("/plans", response_model=BillingPlansResponse)
async def get_plans() -> BillingPlansResponse:
    if not settings.stripe_configured:
        # Billing is wholly disabled: serve an honest env-based fallback catalog.
        currency = settings.stripe_currency
        plans = [
            _free_plan(currency),
            BillingPlanRead(
                code="pro",
                name="Pro",
                price_cents=settings.stripe_pro_price_cents,
                currency=currency,
                interval="month",
                features=_PRO_FEATURES,
            ),
        ]
        if settings.stripe_pro_yearly_price_id:
            # Fallback display only; real yearly amount comes from Stripe when configured.
            plans.append(
                BillingPlanRead(
                    code="pro",
                    name="Pro (yearly)",
                    price_cents=12_000,
                    currency=currency,
                    interval="year",
                    features=_PRO_FEATURES,
                )
            )
    else:
        monthly = await _authoritative_pro_plan(
            price_id=settings.stripe_pro_price_id, expected_interval="month"
        )
        currency = monthly.currency
        plans = [_free_plan(currency), monthly]
        if settings.stripe_pro_yearly_price_id:
            yearly = await _authoritative_pro_plan(
                price_id=settings.stripe_pro_yearly_price_id, expected_interval="year"
            )
            plans.append(yearly)
    return BillingPlansResponse(
        configured=settings.stripe_configured,
        enforcement_enabled=settings.billing_enforcement_enabled,
        plans=plans,
    )


@router.get("/status", response_model=BillingStatusRead)
async def get_billing_status(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BillingStatusRead:
    return _status_response(await _get_subscription(db, current_user.id))


@router.get("/usage", response_model=UsageStatusRead)
async def get_usage_status(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UsageStatusRead:
    snap = await get_usage_snapshot(db, current_user.id)
    return UsageStatusRead(
        pro_entitled=snap.pro_entitled,
        period_start=snap.period_start,
        period_end=snap.period_end,
        ai_tokens_included=snap.ai_tokens_included,
        ai_tokens_used=snap.ai_tokens_used,
        ai_tokens_pack_remaining=snap.ai_tokens_pack_remaining,
        ai_tokens_remaining=snap.ai_tokens_remaining,
        ai_usage_ratio=snap.ai_usage_ratio,
        voice_seconds_included=snap.voice_seconds_included,
        voice_seconds_used=snap.voice_seconds_used,
        voice_seconds_pack_remaining=snap.voice_seconds_pack_remaining,
        voice_seconds_remaining=snap.voice_seconds_remaining,
        voice_usage_ratio=snap.voice_usage_ratio,
        packs_frozen=snap.packs_frozen,
        ai_pack_configured=settings.ai_pack_configured,
        voice_pack_configured=settings.voice_pack_configured,
    )


@router.post("/pack-checkout-session", response_model=BillingSessionResponse)
async def create_pack_checkout_session(
    body: PackCheckoutRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BillingSessionResponse:
    """One-time Pro-only usage top-up. Pack balance rolls until used; freezes without Pro."""
    _require_stripe()
    row = await _get_or_create_subscription(db, current_user.id)
    if not is_pro_entitled(row):
        raise HTTPException(402, "Usage top-ups are available only with an active Pro plan.")
    if body.pack == PACK_AI:
        if not settings.ai_pack_configured:
            raise HTTPException(503, "AI top-up packs are not configured yet.")
        price_id = settings.stripe_ai_pack_price_id
    elif body.pack == PACK_VOICE:
        if not settings.voice_pack_configured:
            raise HTTPException(503, "Voice top-up packs are not configured yet.")
        price_id = settings.stripe_voice_pack_price_id
    else:
        raise HTTPException(422, "Unknown pack type.")

    if not row.stripe_customer_id:
        row.stripe_customer_id = await stripe_svc.create_customer(
            email=current_user.email,
            user_id=current_user.id,
            idempotency_key=f"customer-create:{current_user.id}",
        )
        await db.commit()

    expires_at = int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp())
    try:
        session = await stripe_svc.create_checkout_session(
            customer_id=row.stripe_customer_id,
            user_id=current_user.id,
            price_id=price_id,
            success_url=f"{settings.frontend_url}/billing?pack=success",
            cancel_url=f"{settings.frontend_url}/billing?pack=cancelled",
            idempotency_key=f"pack:{body.pack}:{current_user.id}:{uuid.uuid4().hex[:12]}",
            expires_at=expires_at,
            mode="payment",
            metadata={"user_id": current_user.id, "pack_kind": body.pack},
        )
    except Exception as exc:
        logger.exception("stripe_pack_checkout_failed", extra={"exception_type": type(exc).__name__})
        raise HTTPException(502, "Billing provider is unavailable. Please try again.") from exc
    return BillingSessionResponse(url=_validated_checkout_url(session.get("url")))


async def _reconcile_existing_subscriptions(
    db: AsyncSession, row: Subscription, user_id: str
) -> bool:
    """Fold any live Stripe subscription for this customer into local state.

    Catches a completed subscription whose webhook is still in flight: if Stripe
    already has a nonterminal subscription for exactly this customer, tenant, and
    the configured Price, we adopt it locally and report that Checkout must be
    blocked (True). Fails closed with 409 if more than one such subscription
    exists, so we never silently pick one and leave the other billing.
    """
    subscriptions = await stripe_svc.list_subscriptions_for_customer(row.stripe_customer_id)
    live: list[dict] = []
    for snapshot in subscriptions:
        if snapshot.get("customer") != row.stripe_customer_id:
            continue
        if (snapshot.get("metadata") or {}).get("user_id") != user_id:
            continue
        if not _has_single_configured_price(snapshot):
            continue
        if _is_terminal_status(str(snapshot.get("status") or "")):
            continue
        live.append(snapshot)

    if not live:
        return False
    if len(live) > 1:
        logger.error("stripe_checkout_multiple_live_subscriptions", extra={"user_id": user_id})
        raise HTTPException(409, "Multiple active subscriptions found. Manage them in billing.")

    snapshot = live[0]
    subscription_id = str(snapshot.get("id"))
    if subscription_id in (row.superseded_subscription_ids or []):
        # A retired subscription that is somehow live again must never rebind;
        # block the second Checkout and route the tenant to the portal instead.
        logger.error("stripe_checkout_superseded_subscription_live", extra={"user_id": user_id})
        raise HTTPException(409, "An existing subscription needs attention. Manage it in billing.")

    if row.stripe_subscription_id and row.stripe_subscription_id != subscription_id:
        # We only reach here after the local nonterminal block, so the currently
        # bound subscription is terminal and rebinding onto the replacement is safe.
        _supersede_current_subscription(row, subscription_id)
    _apply_snapshot_to_row(
        row,
        snapshot,
        customer_id=row.stripe_customer_id,
        subscription_id=subscription_id,
        event_created_at=None,
    )
    return True


async def _reuse_open_checkout_session(
    row: Subscription, user_id: str, *, price_id: str
) -> dict | None:
    """Return an existing open Checkout session to reuse, or None.

    Reusing the still-open session prevents minting a second one after the local
    idempotency key has already rotated (or a delayed retry), which would
    otherwise leave two live sessions for the same intent.
    """
    sessions = await stripe_svc.list_open_checkout_sessions(row.stripe_customer_id)
    for session in sessions:
        if session.get("customer") != row.stripe_customer_id:
            continue
        if session.get("status") not in (None, "open"):
            continue
        if (session.get("metadata") or {}).get("user_id") != user_id:
            continue
        if not _session_targets_configured_price(session, price_id=price_id):
            continue
        if not session.get("url"):
            continue
        return session
    return None


def _persist_open_session(row: Subscription, session: dict) -> None:
    row.checkout_session_id = str(session["id"]) if session.get("id") else None
    expires_at = session.get("expires_at")
    row.checkout_session_expires_at = (
        datetime.fromtimestamp(int(expires_at), tz=timezone.utc) if expires_at else None
    )


@router.post("/checkout-session", response_model=BillingSessionResponse)
async def create_checkout_session(
    body: CheckoutSessionRequest = CheckoutSessionRequest(),
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BillingSessionResponse:
    _require_stripe()
    interval = body.interval or "month"
    try:
        price_id = settings.pro_price_id_for_interval(interval)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    # The row is locked FOR UPDATE, serializing all of this tenant's Checkout
    # attempts so reconciliation and session reuse cannot race each other.
    row = await _get_or_create_subscription(db, current_user.id)

    # Refuse a second Checkout for any live local subscription, not just an
    # active one: a recoverable status must be fixed in the portal instead.
    block = _local_checkout_block(row)
    if block:
        raise HTTPException(409, block)

    # For a tenant that already has a Stripe customer, consult Stripe
    # authoritatively before opening anything new — still under the per-user lock.
    if row.stripe_customer_id:
        try:
            blocked = await _reconcile_existing_subscriptions(db, row, current_user.id)
        except HTTPException:
            raise
        except Exception as exc:
            if _is_missing_stripe_customer_error(exc):
                _clear_stale_stripe_customer(row)
                await db.commit()
                # Re-lock after commit so the create path still serializes.
                row = await _get_or_create_subscription(db, current_user.id)
            else:
                await db.rollback()
                logger.exception(
                    "stripe_reconcile_failed", extra={"exception_type": type(exc).__name__}
                )
                raise HTTPException(502, "Billing provider is unavailable. Please try again.") from exc
        else:
            if blocked:
                # Persist the reconciled state, then direct the tenant to the portal.
                await db.commit()
                raise HTTPException(409, "A subscription already exists. Manage it in billing.")

            try:
                existing = await _reuse_open_checkout_session(
                    row, current_user.id, price_id=price_id
                )
            except Exception as exc:
                if _is_missing_stripe_customer_error(exc):
                    _clear_stale_stripe_customer(row)
                    await db.commit()
                    row = await _get_or_create_subscription(db, current_user.id)
                else:
                    await db.rollback()
                    logger.exception(
                        "stripe_open_session_lookup_failed",
                        extra={"exception_type": type(exc).__name__},
                    )
                    raise HTTPException(
                        502, "Billing provider is unavailable. Please try again."
                    ) from exc
            else:
                if existing is not None:
                    url = _validated_checkout_url(existing.get("url"))
                    _persist_open_session(row, existing)
                    await db.commit()
                    return BillingSessionResponse(url=url)

    try:
        if not row.stripe_customer_id:
            # Use a recover-safe key: stable create for first time, unique when
            # replacing a deleted Stripe customer so idempotency cannot revive
            # a dead cus_ id from Stripe's 24h idempotency cache.
            recover_token = uuid.uuid4().hex[:12]
            row.stripe_customer_id = await stripe_svc.create_customer(
                email=current_user.email,
                user_id=current_user.id,
                idempotency_key=f"customer-create:{current_user.id}:{recover_token}",
            )
        checkout_key = _checkout_idempotency_key(row)
        # Durably persist the customer mapping and idempotency key BEFORE the
        # provider call. If the process dies after Stripe succeeds, the retry
        # reuses the same key (and customer) instead of orphaning a session.
        await db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("stripe_customer_persist_failed", extra={"exception_type": type(exc).__name__})
        raise HTTPException(502, "Billing provider is unavailable. Please try again.") from exc

    try:
        expires_at = int(
            (row.checkout_idempotency_created_at + timedelta(seconds=_CHECKOUT_KEY_TTL_SECONDS)).timestamp()
        )
        session = await stripe_svc.create_checkout_session(
            customer_id=row.stripe_customer_id,
            user_id=current_user.id,
            price_id=price_id,
            success_url=f"{settings.frontend_url}/billing?checkout=success",
            cancel_url=f"{settings.frontend_url}/pricing?checkout=cancelled",
            # Include interval so monthly/yearly retries never collide.
            idempotency_key=f"checkout:{interval}:{checkout_key}",
            expires_at=expires_at,
            metadata={"user_id": current_user.id, "interval": interval},
        )
    except Exception as exc:
        logger.exception("stripe_checkout_session_failed", extra={"exception_type": type(exc).__name__})
        raise HTTPException(502, "Billing provider is unavailable. Please try again.") from exc

    url = _validated_checkout_url(session.get("url"))
    # Record the freshly created session so a subsequent request can detect it is
    # still open and reuse it rather than creating a duplicate.
    try:
        _persist_open_session(row, session)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.warning(
            "stripe_checkout_session_persist_failed", extra={"exception_type": type(exc).__name__}
        )
    return BillingSessionResponse(url=url)


@router.post("/portal-session", response_model=BillingSessionResponse)
async def create_portal_session(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BillingSessionResponse:
    _require_stripe()
    row = await _get_subscription(db, current_user.id)
    if row is None or not row.stripe_customer_id:
        raise HTTPException(409, "No billing account exists yet.")
    try:
        url = await stripe_svc.create_portal_session(
            customer_id=row.stripe_customer_id,
            return_url=f"{settings.frontend_url}/billing",
        )
    except Exception as exc:
        logger.exception("stripe_portal_session_failed", extra={"exception_type": type(exc).__name__})
        raise HTTPException(502, "Billing provider is unavailable. Please try again.") from exc
    return BillingSessionResponse(url=url)


class _RetryableWebhookError(Exception):
    """Signals a transient condition (e.g. a mapping not yet committed) that
    must be redelivered rather than durably acknowledged."""


def _price_id(subscription: dict) -> str | None:
    items = subscription.get("items", {}).get("data", [])
    if not items:
        return None
    price = items[0].get("price", {})
    return price.get("id")


def _has_single_configured_price(snapshot: dict) -> bool:
    """True only when the subscription carries exactly one item on a configured Pro price."""
    items = (snapshot.get("items") or {}).get("data") or []
    if len(items) != 1:
        return False
    return (items[0].get("price") or {}).get("id") in settings.configured_pro_price_ids


def _snapshot_matches_owner(
    snapshot: dict, *, subscription_id: str, customer_id: str, user_id: str
) -> bool:
    """The authoritative object must describe the exact subscription and tenant."""
    if snapshot.get("id") != subscription_id:
        return False
    if snapshot.get("customer") != customer_id:
        return False
    metadata_user_id = (snapshot.get("metadata") or {}).get("user_id")
    return metadata_user_id == user_id


def _supersede_current_subscription(row: Subscription, replacement_id: str) -> None:
    """Retire the current subscription ID and bind the row to its replacement."""
    current_id = row.stripe_subscription_id
    if current_id and current_id != replacement_id:
        retired = list(row.superseded_subscription_ids or [])
        if current_id not in retired:
            retired.append(current_id)
        row.superseded_subscription_ids = retired
    row.stripe_subscription_id = replacement_id
    row.last_event_created_at = None
    row.checkout_idempotency_key = None
    row.checkout_idempotency_created_at = None
    row.checkout_session_id = None
    row.checkout_session_expires_at = None


def _subscription_period_end(snapshot: dict) -> int | None:
    """Stripe API 2025+ may put period end on items; support both shapes."""
    top = snapshot.get("current_period_end")
    if top is not None:
        try:
            return int(top)
        except (TypeError, ValueError):
            pass
    items = (snapshot.get("items") or {}).get("data") or []
    if items:
        item_end = items[0].get("current_period_end")
        if item_end is not None:
            try:
                return int(item_end)
            except (TypeError, ValueError):
                return None
    return None


def _apply_snapshot_to_row(
    row: Subscription,
    snapshot: dict,
    *,
    customer_id: str,
    subscription_id: str,
    event_created_at: int | None,
) -> None:
    """Apply one already-validated authoritative subscription snapshot."""
    status = str(snapshot.get("status") or "unknown")
    entitled = status in _ACTIVE_STATUSES and _has_single_configured_price(snapshot)
    row.status = status
    row.plan = "pro" if entitled else "free"
    row.stripe_customer_id = customer_id
    row.stripe_subscription_id = subscription_id
    price_id = _price_id(snapshot)
    if price_id:
        row.stripe_price_id = price_id
    period_end = _subscription_period_end(snapshot)
    row.current_period_end = (
        datetime.fromtimestamp(period_end, tz=timezone.utc) if period_end else None
    )
    row.cancel_at_period_end = bool(snapshot.get("cancel_at_period_end", False))
    if event_created_at is not None:
        row.last_event_created_at = event_created_at
    row.checkout_session_id = None
    row.checkout_session_expires_at = None
    if _is_terminal_status(status):
        # A completed lifecycle must never reuse the Checkout idempotency key
        # that created it when the customer later starts a replacement.
        row.checkout_idempotency_key = None
        row.checkout_idempotency_created_at = None
    row.updated_at = datetime.now(timezone.utc)


async def _apply_subscription_event(
    db: AsyncSession,
    *,
    event_type: str,
    event_created_at: int,
    subscription: dict,
) -> None:
    customer_id = subscription.get("customer")
    subscription_id = subscription.get("id")
    if not customer_id or not subscription_id:
        logger.warning("stripe_webhook_subscription_missing_ids", extra={"event_type": event_type})
        return
    customer_id = str(customer_id)
    subscription_id = str(subscription_id)

    rows = (
        await db.execute(
            select(Subscription)
            .where(
                or_(
                    Subscription.stripe_customer_id == customer_id,
                    Subscription.stripe_subscription_id == subscription_id,
                )
            )
            .with_for_update()
        )
    ).scalars().all()
    if len(rows) > 1:
        logger.error("stripe_webhook_mapping_conflict", extra={"event_type": event_type})
        raise _RetryableWebhookError("ambiguous subscription owner mapping")
    row = rows[0] if rows else None
    if row is None:
        logger.warning("stripe_webhook_subscription_owner_not_found", extra={"event_type": event_type})
        raise _RetryableWebhookError("subscription owner mapping not available yet")

    if row.stripe_customer_id and row.stripe_customer_id != customer_id:
        logger.warning("stripe_webhook_customer_mismatch", extra={"event_type": event_type})
        return
    if subscription_id in set(row.superseded_subscription_ids or []):
        logger.info("stripe_webhook_superseded_subscription_ignored", extra={"event_type": event_type})
        return

    metadata_user_id = (subscription.get("metadata") or {}).get("user_id")
    if metadata_user_id and metadata_user_id != row.user_id:
        logger.warning("stripe_webhook_user_mismatch", extra={"event_type": event_type})
        return

    current_id = row.stripe_subscription_id
    is_replacement = bool(current_id and current_id != subscription_id)

    if event_type == "customer.subscription.deleted":
        # Stripe may deliver deletion before creation/update. When no lifecycle
        # is bound yet, accept only an exact tenant + configured-Price snapshot
        # and materialize the canceled lifecycle so later stale updates cannot
        # resurrect it. A deletion for a different already-bound ID is ignored.
        if current_id is None:
            if metadata_user_id != row.user_id or not _has_single_configured_price(subscription):
                logger.info("stripe_webhook_unknown_deleted_subscription_ignored")
                return
            row.stripe_subscription_id = subscription_id
        elif current_id != subscription_id:
            logger.info("stripe_webhook_unknown_deleted_subscription_ignored")
            return
        if row.last_event_created_at is not None and event_created_at < row.last_event_created_at:
            logger.info("stripe_webhook_older_event_ignored", extra={"event_type": event_type})
            return
        snapshot = dict(subscription)
        snapshot["status"] = "canceled"
        _apply_snapshot_to_row(
            row,
            snapshot,
            customer_id=customer_id,
            subscription_id=subscription_id,
            event_created_at=event_created_at,
        )
        return

    # Created/updated events reconcile against Stripe's current object. This is
    # the only source allowed to bind a new or replacement subscription ID.
    snapshot = await stripe_svc.retrieve_subscription(subscription_id)
    if not _snapshot_matches_owner(
        snapshot,
        subscription_id=subscription_id,
        customer_id=customer_id,
        user_id=row.user_id,
    ):
        logger.warning("stripe_webhook_retrieved_state_inconsistent", extra={"event_type": event_type})
        return
    snapshot_status = str(snapshot.get("status") or "unknown")

    if current_id != subscription_id:
        # Initial and replacement bindings must be our exact configured product,
        # and a terminal snapshot is never useful as a new current lifecycle.
        if not _has_single_configured_price(snapshot) or _is_terminal_status(snapshot_status):
            logger.warning("stripe_webhook_replacement_not_eligible", extra={"event_type": event_type})
            return
        if is_replacement and not _is_terminal_status(row.status):
            logger.warning("stripe_webhook_subscription_mismatch", extra={"event_type": event_type})
            return
        _supersede_current_subscription(row, subscription_id)

    if row.last_event_created_at is not None and event_created_at < row.last_event_created_at:
        logger.info("stripe_webhook_older_event_ignored", extra={"event_type": event_type})
        return
    if (
        row.last_event_created_at == event_created_at
        and row.status == "canceled"
        and snapshot_status != "canceled"
    ):
        logger.info("stripe_webhook_terminal_event_preserved", extra={"event_type": event_type})
        return

    _apply_snapshot_to_row(
        row,
        snapshot,
        customer_id=customer_id,
        subscription_id=subscription_id,
        event_created_at=event_created_at,
    )


async def _read_bounded_body(request: Request, limit: int) -> bytes:
    """Buffer the request body, rejecting anything over ``limit`` bytes.

    Works for chunked transfers (no Content-Length) because the running total is
    checked as each chunk arrives, before the whole body is materialised.
    """
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise HTTPException(413, "Webhook payload too large.")
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    if not settings.stripe_webhook_secret:
        raise HTTPException(503, "Billing webhook is not configured.")
    if not stripe_signature:
        raise HTTPException(400, "Missing Stripe signature.")
    payload = await _read_bounded_body(request, _MAX_WEBHOOK_BYTES)
    # Verify the signature over the raw body before any parsing or state change.
    try:
        event = stripe_svc.construct_event(payload, stripe_signature)
    except Exception as exc:
        logger.warning("stripe_webhook_signature_invalid", extra={"exception_type": type(exc).__name__})
        raise HTTPException(400, "Invalid Stripe signature.") from exc

    # Reject events from the wrong Stripe mode (e.g. a test event delivered to a
    # live endpoint) before they can touch subscription state. livemode must be a
    # real boolean; a missing or non-bool value is treated as malformed.
    livemode = event.get("livemode")
    if not isinstance(livemode, bool):
        logger.warning("stripe_webhook_livemode_invalid", extra={"livemode": livemode})
        raise HTTPException(400, "Stripe event livemode is missing or invalid.")
    if livemode != settings.stripe_expected_livemode:
        logger.warning("stripe_webhook_livemode_mismatch", extra={"livemode": livemode})
        raise HTTPException(400, "Stripe event livemode does not match this environment.")

    event_id = str(event.get("id") or "")
    event_type = str(event.get("type") or "")
    event_created_at = int(event.get("created") or 0)
    if not event_id or not event_type or event_created_at < 1:
        raise HTTPException(400, "Malformed Stripe event.")

    if await db.get(StripeWebhookEvent, event_id):
        return {"received": True, "duplicate": True}

    # State change and the idempotency-ledger insert commit together, so the
    # response is 2xx only after durable acceptance and concurrent duplicates
    # collide on the event_id primary key rather than double-applying.
    became_pro = False
    upgrade_user_id: str | None = None
    try:
        if event_type in _SUBSCRIPTION_EVENTS:
            subscription = event.get("data", {}).get("object", {})
            customer_id = subscription.get("customer")
            subscription_id = subscription.get("id")
            was_pro = False
            mapped_user_id: str | None = None
            if customer_id or subscription_id:
                prior = (
                    await db.execute(
                        select(Subscription).where(
                            or_(
                                Subscription.stripe_customer_id == str(customer_id or ""),
                                Subscription.stripe_subscription_id == str(subscription_id or ""),
                            )
                        )
                    )
                ).scalars().all()
                if len(prior) == 1:
                    was_pro = is_pro_entitled(prior[0])
                    mapped_user_id = prior[0].user_id
                    # Expire so the locked re-load inside _apply_subscription_event
                    # is authoritative (avoids stale identity-map snapshots).
                    db.expire(prior[0])
            await _apply_subscription_event(
                db,
                event_type=event_type,
                event_created_at=event_created_at,
                subscription=subscription,
            )
            if mapped_user_id:
                after = (
                    await db.execute(
                        select(Subscription).where(Subscription.user_id == mapped_user_id)
                    )
                ).scalar_one_or_none()
                if (not was_pro) and is_pro_entitled(after):
                    became_pro = True
                    upgrade_user_id = mapped_user_id
        elif event_type == "checkout.session.completed":
            session = event.get("data", {}).get("object", {}) or {}
            if session.get("mode") == "payment":
                await _apply_pack_checkout_completed(db, session)
        db.add(
            StripeWebhookEvent(
                event_id=event_id,
                event_type=event_type,
                event_created_at=event_created_at,
            )
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return {"received": True, "duplicate": True}
    except _RetryableWebhookError as exc:
        await db.rollback()
        logger.warning("stripe_webhook_retry_requested", extra={"reason": str(exc)})
        raise HTTPException(503, "Webhook could not be processed yet; please retry.") from exc
    except HTTPException:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception(
            "stripe_webhook_processing_failed", extra={"exception_type": type(exc).__name__}
        )
        raise HTTPException(502, "Webhook processing failed.") from exc

    if became_pro and upgrade_user_id and hasattr(request.app.state, "vector_store"):
        try:
            from app.services.rag_backfill import backfill_embeddings_for_user

            await backfill_embeddings_for_user(
                db,
                user_id=upgrade_user_id,
                vector_store=request.app.state.vector_store,
            )
        except Exception as exc:
            logger.warning(
                "pro_upgrade_backfill_failed",
                extra={"exception_type": type(exc).__name__},
            )

    return {"received": True, "duplicate": False}


async def _apply_pack_checkout_completed(db: AsyncSession, session: dict) -> None:
    metadata = session.get("metadata") or {}
    user_id = metadata.get("user_id") or session.get("client_reference_id")
    pack_kind = metadata.get("pack_kind")
    session_id = session.get("id")
    if not user_id or not pack_kind or not session_id:
        logger.warning("stripe_pack_checkout_missing_fields")
        return
    if pack_kind not in {PACK_AI, PACK_VOICE}:
        logger.warning("stripe_pack_checkout_unknown_kind", extra={"pack_kind": pack_kind})
        return
    row = await _get_subscription(db, str(user_id))
    if not is_pro_entitled(row):
        # Still credit the balance so it freezes until they regain Pro.
        logger.info("stripe_pack_credited_while_not_pro", extra={"user_id": user_id})
    payment_intent = session.get("payment_intent")
    await credit_pack_from_checkout(
        db,
        user_id=str(user_id),
        pack_kind=str(pack_kind),
        checkout_session_id=str(session_id),
        payment_intent_id=str(payment_intent) if payment_intent else None,
    )


async def require_pro_entitlement(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AuthenticatedUser:
    """Feature gate that is inert until BILLING_ENFORCEMENT_ENABLED is explicit."""
    if not settings.billing_enforcement_enabled:
        return current_user
    row = await _get_subscription(db, current_user.id)
    if row is None or row.plan != "pro" or row.status not in _ACTIVE_STATUSES:
        raise HTTPException(402, "A Pro subscription is required for this feature.")
    return current_user
