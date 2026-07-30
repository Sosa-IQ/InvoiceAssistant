import asyncio
import time
from typing import Any

import stripe

from app.config import settings

# Prices are effectively immutable in Stripe for amount/currency/interval; only
# fields like ``active`` can change. A short TTL lets a deactivation propagate
# without turning every /plans call into a synchronous Stripe round trip.
_PRICE_CACHE_TTL_SECONDS = 600


def _as_dict(obj: Any) -> dict:
    """Convert Stripe SDK objects to plain dicts (dict(stripe_obj) is unsafe)."""
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "to_dict_recursive"):
        return obj.to_dict_recursive()
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return dict(obj)


class StripeService:
    """Small async adapter around Stripe's synchronous Python SDK."""

    def __init__(self) -> None:
        self._price_cache: dict[str, tuple[float, dict]] = {}

    async def create_customer(
        self, *, email: str | None, user_id: str, idempotency_key: str
    ) -> str:
        customer = await asyncio.to_thread(
            stripe.Customer.create,
            api_key=settings.stripe_secret_key,
            idempotency_key=idempotency_key,
            email=email or None,
            metadata={"user_id": user_id},
        )
        return str(customer["id"])

    async def create_checkout_session(
        self,
        *,
        customer_id: str,
        user_id: str,
        price_id: str,
        success_url: str,
        cancel_url: str,
        idempotency_key: str,
        expires_at: int,
        mode: str = "subscription",
        metadata: dict | None = None,
    ) -> dict:
        meta = {"user_id": user_id, **(metadata or {})}
        kwargs: dict = {
            "api_key": settings.stripe_secret_key,
            "idempotency_key": idempotency_key,
            "mode": mode,
            "customer": customer_id,
            "line_items": [{"price": price_id, "quantity": 1}],
            "client_reference_id": user_id,
            "metadata": meta,
            "success_url": success_url,
            "cancel_url": cancel_url,
            "expires_at": expires_at,
        }
        if mode == "subscription":
            kwargs["subscription_data"] = {"metadata": {"user_id": user_id}}
            kwargs["allow_promotion_codes"] = True
        session = await asyncio.to_thread(stripe.checkout.Session.create, **kwargs)
        data = _as_dict(session)
        return {
            "id": str(data["id"]),
            "url": str(data["url"]),
            "expires_at": int(data["expires_at"]),
        }

    async def list_subscriptions_for_customer(self, customer_id: str) -> list[dict]:
        """Authoritatively list a customer's subscriptions across all statuses.

        Used to reconcile a subscription whose webhook is delayed before a second
        Checkout can be opened, so the tenant is never double-subscribed.
        """
        result = await asyncio.to_thread(
            stripe.Subscription.list,
            api_key=settings.stripe_secret_key,
            customer=customer_id,
            status="all",
            limit=100,
        )
        data = _as_dict(result).get("data") or []
        return [_as_dict(item) for item in data]

    async def list_open_checkout_sessions(self, customer_id: str) -> list[dict]:
        """List a customer's open Checkout sessions with line items expanded.

        Line items are expanded so the caller can confirm a candidate session is
        for exactly the configured Price before reusing it.
        """
        result = await asyncio.to_thread(
            stripe.checkout.Session.list,
            api_key=settings.stripe_secret_key,
            customer=customer_id,
            status="open",
            limit=100,
            expand=["data.line_items"],
        )
        data = _as_dict(result).get("data") or []
        return [_as_dict(item) for item in data]

    async def create_portal_session(self, *, customer_id: str, return_url: str) -> str:
        session = await asyncio.to_thread(
            stripe.billing_portal.Session.create,
            api_key=settings.stripe_secret_key,
            customer=customer_id,
            return_url=return_url,
        )
        return str(_as_dict(session)["url"])

    async def retrieve_price(self, price_id: str) -> dict:
        """Fetch the configured Price from Stripe, cached briefly per process."""
        now = time.monotonic()
        cached = self._price_cache.get(price_id)
        if cached is not None and now - cached[0] < _PRICE_CACHE_TTL_SECONDS:
            return cached[1]
        price = await asyncio.to_thread(
            stripe.Price.retrieve,
            price_id,
            api_key=settings.stripe_secret_key,
        )
        data = _as_dict(price)
        self._price_cache[price_id] = (now, data)
        return data

    async def retrieve_subscription(self, subscription_id: str) -> dict:
        """Fetch the authoritative current state of a subscription from Stripe."""
        subscription = await asyncio.to_thread(
            stripe.Subscription.retrieve,
            subscription_id,
            api_key=settings.stripe_secret_key,
        )
        return _as_dict(subscription)

    def construct_event(self, payload: bytes, signature: str) -> dict:
        event = stripe.Webhook.construct_event(
            payload,
            signature,
            settings.stripe_webhook_secret,
        )
        return _as_dict(event)


stripe_service = StripeService()
