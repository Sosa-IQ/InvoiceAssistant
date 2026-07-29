"""Stripe-ready billing contract over the real API and PostgreSQL."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.api import billing as billing_api
from app.config import Settings, settings as app_settings
from app.models.db_models import Subscription
from tests.support.alembic_runner import upgrade_to_head
from tests.support.app_client import api_client, create_tenant
from tests.support.postgres import bootstrap_supabase_stubs, scratch_database


def _default_price() -> dict:
    # Deliberately diverges from the env display value (1200) so tests prove the
    # catalog is built from Stripe, not from STRIPE_PRO_PRICE_CENTS.
    return {
        "id": "price_test_pro",
        "active": True,
        "currency": "usd",
        "unit_amount": 1500,
        "recurring": {"interval": "month"},
    }


class FakeStripeService:
    def __init__(self) -> None:
        self.customer_calls: list[dict] = []
        self.checkout_calls: list[dict] = []
        self.portal_calls: list[dict] = []
        self.events: dict[bytes, dict] = {}
        self.price: dict = _default_price()
        self.price_error = False
        self.subscription_state: dict[str, dict] = {}
        # Authoritative Stripe-side state a test can seed to exercise the
        # reconcile-before-checkout and open-session-reuse paths.
        self.subscriptions_by_customer: dict[str, list[dict]] = {}
        self.open_sessions: list[dict] = []
        self._session_seq = 0

    async def create_customer(self, **kwargs) -> str:
        self.customer_calls.append(kwargs)
        return "cus_test_owner"

    async def create_checkout_session(self, **kwargs) -> dict:
        self.checkout_calls.append(kwargs)
        self._session_seq += 1
        session = {
            "id": f"cs_test_{self._session_seq}",
            "url": f"https://checkout.stripe.com/c/pay/cs_test_{self._session_seq}",
            "expires_at": kwargs["expires_at"],
            "customer": kwargs["customer_id"],
            "status": "open",
            "client_reference_id": kwargs["user_id"],
            "metadata": {"user_id": kwargs["user_id"]},
            "line_items": {"data": [{"price": {"id": kwargs["price_id"]}}]},
        }
        self.open_sessions.append(deepcopy(session))
        return session

    async def create_portal_session(self, **kwargs) -> str:
        self.portal_calls.append(kwargs)
        return "https://billing.stripe.com/p/session/test"

    async def retrieve_price(self, price_id: str) -> dict:
        if self.price_error:
            raise RuntimeError("stripe price unavailable")
        return deepcopy(self.price)

    async def retrieve_subscription(self, subscription_id: str) -> dict:
        return deepcopy(self.subscription_state[subscription_id])

    async def list_subscriptions_for_customer(self, customer_id: str) -> list[dict]:
        return [deepcopy(s) for s in self.subscriptions_by_customer.get(customer_id, [])]

    async def list_open_checkout_sessions(self, customer_id: str) -> list[dict]:
        return [
            deepcopy(s)
            for s in self.open_sessions
            if s.get("customer") == customer_id
        ]

    def construct_event(self, payload: bytes, signature: str) -> dict:
        if signature != "valid-signature":
            raise ValueError("bad signature")
        event = deepcopy(self.events[payload])
        obj = event.get("data", {}).get("object", {})
        # Seed the authoritative current state from the event unless a test has
        # explicitly registered a divergent one to exercise reconciliation.
        if str(event.get("type", "")).startswith("customer.subscription.") and obj.get("id"):
            self.subscription_state.setdefault(obj["id"], deepcopy(obj))
        return event


@pytest.fixture
def stripe_config(monkeypatch: pytest.MonkeyPatch):
    values = {
        "stripe_secret_key": "sk_test_example",
        "stripe_webhook_secret": "whsec_example",
        "stripe_pro_price_id": "price_test_pro",
        "stripe_pro_price_cents": 1200,
        "stripe_currency": "USD",
        "stripe_expected_livemode": False,
        "billing_enforcement_enabled": False,
        "frontend_url": "http://localhost:5173",
    }
    originals = {name: getattr(app_settings, name) for name in values}
    for name, value in values.items():
        monkeypatch.setattr(app_settings, name, value)
    yield
    for name, value in originals.items():
        setattr(app_settings, name, value)


@pytest_asyncio.fixture
async def billing_api_fixture(tmp_path, monkeypatch: pytest.MonkeyPatch, stripe_config):
    async with scratch_database("ia_billing") as url:
        await bootstrap_supabase_stubs(url)
        await upgrade_to_head(url)
        owner = await create_tenant(url, "billing-owner@example.com")
        other = await create_tenant(url, "billing-other@example.com")
        fake = FakeStripeService()
        monkeypatch.setattr(billing_api, "stripe_svc", fake)
        async with api_client(url, {"owner": owner, "other": other}, tmp_path / "data") as (request, harness):
            yield request, owner, other, fake, harness


def subscription_event(
    *,
    event_id: str,
    created: int,
    user_id: str | None = None,
    status: str = "active",
    customer: str = "cus_test_owner",
    subscription_id: str = "sub_owner",
    price_id: str = "price_test_pro",
    event_type: str = "customer.subscription.updated",
    livemode: bool = False,
) -> dict:
    metadata = {"user_id": user_id} if user_id is not None else {}
    return {
        "id": event_id,
        "type": event_type,
        "created": created,
        "livemode": livemode,
        "data": {
            "object": {
                "id": subscription_id,
                "customer": customer,
                "status": status,
                "cancel_at_period_end": False,
                "current_period_end": 1_800_000_000,
                "metadata": metadata,
                "items": {"data": [{"price": {"id": price_id}}]},
            }
        },
    }


async def _start_checkout(request, tenant) -> None:
    """Establish the tenant's local Stripe customer mapping via Checkout."""
    response = await request(tenant, "post", "/api/billing/checkout-session")
    assert response.status_code == 200, response.text


def _webhook(request, tenant, payload: bytes):
    return request(
        tenant,
        "post",
        "/api/billing/webhook",
        content=payload,
        headers={"stripe-signature": "valid-signature"},
    )


async def _subscription_row(harness, user_id: str) -> Subscription:
    async with harness["session_factory"]() as session:
        result = await session.execute(
            select(Subscription).where(Subscription.user_id == user_id)
        )
        return result.scalar_one()


def test_enforcement_requires_complete_stripe_configuration() -> None:
    with pytest.raises(ValueError, match="Stripe"):
        Settings(
            database_url="postgresql+asyncpg://localhost/test",
            billing_enforcement_enabled=True,
        )


def test_partial_stripe_configuration_is_rejected_even_without_enforcement() -> None:
    with pytest.raises(ValueError, match="configured together"):
        Settings(
            database_url="postgresql+asyncpg://localhost/test",
            stripe_secret_key="sk_test_example",
        )


def test_stripe_secret_key_prefix_must_be_recognized() -> None:
    with pytest.raises(ValueError, match="sk_test_ or sk_live_"):
        Settings(
            database_url="postgresql+asyncpg://localhost/test",
            stripe_secret_key="not_a_server_key",
            stripe_webhook_secret="whsec_example",
            stripe_pro_price_id="price_example",
        )


def test_stripe_secret_key_mode_must_match_expected_livemode() -> None:
    with pytest.raises(ValueError, match="mode must match"):
        Settings(
            database_url="postgresql+asyncpg://localhost/test",
            stripe_secret_key="sk_test_example",
            stripe_webhook_secret="whsec_example",
            stripe_pro_price_id="price_example",
            stripe_expected_livemode=True,
        )


@pytest.mark.parametrize(
    "frontend_url",
    [
        "https://example.com/path",
        "https://example.com?next=/billing",
        "https://example.com/#fragment",
        "https://user:pass@example.com",
        "https://example.com:not-a-port",
    ],
)
def test_frontend_url_must_be_an_origin(frontend_url: str) -> None:
    with pytest.raises(ValueError, match="FRONTEND_URL"):
        Settings(database_url="sqlite+aiosqlite:///./test.db", frontend_url=frontend_url)


def test_frontend_url_normalizes_a_single_trailing_slash() -> None:
    configured = Settings(
        database_url="sqlite+aiosqlite:///./test.db",
        frontend_url="https://example.com:8443/",
    )

    assert configured.frontend_url == "https://example.com:8443"


def test_production_stripe_configuration_requires_https_frontend() -> None:
    with pytest.raises(ValueError, match="HTTPS"):
        Settings(
            database_url="postgresql+asyncpg://localhost/test",
            app_environment="production",
            stripe_secret_key="sk_test_example",
            stripe_webhook_secret="whsec_example",
            stripe_pro_price_id="price_example",
            frontend_url="http://example.test",
        )


async def test_plans_use_stripe_authoritative_price_not_env_display(billing_api_fixture) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    # Stripe reports $15.00; the env display value is $12.00. The catalog must
    # reflect Stripe, proving it is never built from STRIPE_PRO_PRICE_CENTS.
    response = await request(owner, "get", "/api/billing/plans")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["configured"] is True
    assert body["enforcement_enabled"] is False
    assert body["plans"][0]["code"] == "free"
    assert body["plans"][0]["currency"] == "USD"
    assert body["plans"][1] == {
        "code": "pro",
        "name": "Pro",
        "price_cents": 1500,
        "currency": "USD",
        "interval": "month",
        "features": [
            "Email invoice delivery",
            "AI-assisted drafting and edits",
            "Voice input",
            "Automatic smart suggestions from your invoices",
        ],
    }


async def test_plans_fail_closed_when_stripe_price_unavailable(billing_api_fixture) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    fake.price_error = True
    response = await request(owner, "get", "/api/billing/plans")
    # No silent divergent env display: a provider failure surfaces as an error.
    assert response.status_code == 502


async def test_plans_reject_misconfigured_stripe_price(billing_api_fixture) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    # An inactive (or non-recurring) price is not usable and must not be shown.
    fake.price = {
        "id": "price_test_pro",
        "active": False,
        "currency": "usd",
        "unit_amount": 1500,
        "recurring": {"interval": "month"},
    }
    response = await request(owner, "get", "/api/billing/plans")
    assert response.status_code == 502


async def test_plans_fall_back_honestly_when_billing_disabled(
    billing_api_fixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    request, owner, _, _, _ = billing_api_fixture
    monkeypatch.setattr(app_settings, "stripe_secret_key", "")
    monkeypatch.setattr(app_settings, "stripe_webhook_secret", "")
    monkeypatch.setattr(app_settings, "stripe_pro_price_id", "")
    response = await request(owner, "get", "/api/billing/plans")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["configured"] is False
    assert body["plans"][1]["price_cents"] == 1200
    assert body["plans"][1]["currency"] == "USD"


async def test_checkout_is_server_owned_and_persists_idempotency_args(billing_api_fixture) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    response = await request(owner, "post", "/api/billing/checkout-session")
    assert response.status_code == 200, response.text
    assert response.json() == {"url": "https://checkout.stripe.com/c/pay/cs_test_1"}
    # The customer create carries a stable per-user idempotency key.
    assert fake.customer_calls == [{
        "email": owner.email,
        "user_id": owner.id,
        "idempotency_key": f"customer-create:{owner.id}",
    }]
    assert len(fake.checkout_calls) == 1
    checkout = fake.checkout_calls[0]
    assert checkout["customer_id"] == "cus_test_owner"
    assert checkout["user_id"] == owner.id
    assert checkout["price_id"] == "price_test_pro"
    assert checkout["success_url"] == "http://localhost:5173/billing?checkout=success"
    assert checkout["cancel_url"] == "http://localhost:5173/pricing?checkout=cancelled"
    assert checkout["idempotency_key"].startswith("checkout:")
    # Session lifetime tracks the 1-hour key TTL so rotation cannot leave an
    # older open session behind.
    assert isinstance(checkout["expires_at"], int)

    status = await request(owner, "get", "/api/billing/status")
    assert status.json()["stripe_customer_id"] == "cus_test_owner"
    assert status.json()["plan"] == "free"


async def test_checkout_reuses_persisted_idempotency_keys_across_retries(billing_api_fixture) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    first = await request(owner, "post", "/api/billing/checkout-session")
    second = await request(owner, "post", "/api/billing/checkout-session")
    assert first.status_code == 200 and second.status_code == 200, second.text
    # The customer is created once; the retry reuses the persisted mapping.
    assert len(fake.customer_calls) == 1
    # Stripe's authoritative open session is reused without another create.
    assert len(fake.checkout_calls) == 1
    assert first.json() == second.json()


async def test_delayed_webhook_subscription_is_reconciled_before_second_checkout(
    billing_api_fixture,
) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    await _start_checkout(request, owner)
    fake.open_sessions.clear()
    delayed = subscription_event(
        event_id="unused",
        created=300,
        user_id=owner.id,
        subscription_id="sub_delayed",
    )["data"]["object"]
    fake.subscriptions_by_customer["cus_test_owner"] = [delayed]

    response = await request(owner, "post", "/api/billing/checkout-session")

    assert response.status_code == 409
    assert len(fake.checkout_calls) == 1
    status = (await request(owner, "get", "/api/billing/status")).json()
    assert status["plan"] == "pro"
    assert status["stripe_subscription_id"] == "sub_delayed"


async def test_checkout_rotates_expiring_key_after_authoritative_session_miss(
    billing_api_fixture,
) -> None:
    request, owner, _, fake, harness = billing_api_fixture
    await _start_checkout(request, owner)
    first_key = fake.checkout_calls[0]["idempotency_key"]
    fake.open_sessions.clear()
    async with harness["session_factory"]() as session:
        row = (
            await session.execute(
                select(Subscription).where(Subscription.user_id == owner.id)
            )
        ).scalar_one()
        row.checkout_idempotency_created_at = datetime.now(timezone.utc) - timedelta(minutes=31)
        row.checkout_session_id = None
        row.checkout_session_expires_at = None
        await session.commit()

    response = await request(owner, "post", "/api/billing/checkout-session")

    assert response.status_code == 200, response.text
    assert len(fake.checkout_calls) == 2
    assert fake.checkout_calls[1]["idempotency_key"] != first_key
    assert fake.checkout_calls[1]["expires_at"] >= int(
        (datetime.now(timezone.utc) + timedelta(minutes=59)).timestamp()
    )


@pytest.mark.parametrize("status", ["past_due", "incomplete", "unpaid"])
async def test_recoverable_subscription_statuses_block_new_checkout(
    billing_api_fixture, status: str
) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    await _start_checkout(request, owner)
    active_payload = b"active-before-recovery"
    fake.events[active_payload] = subscription_event(
        event_id=f"evt_active_{status}", created=200, user_id=owner.id
    )
    assert (await _webhook(request, owner, active_payload)).status_code == 200

    recovery_payload = f"recovery-{status}".encode()
    recovery = subscription_event(
        event_id=f"evt_{status}", created=300, user_id=owner.id, status=status
    )
    fake.events[recovery_payload] = recovery
    fake.subscription_state["sub_owner"] = deepcopy(recovery["data"]["object"])
    assert (await _webhook(request, owner, recovery_payload)).status_code == 200

    response = await request(owner, "post", "/api/billing/checkout-session")
    assert response.status_code == 409
    assert "Manage it in billing" in response.json()["detail"]
    assert len(fake.checkout_calls) == 1


async def test_canceled_subscription_can_rebind_once_and_superseded_events_are_ignored(
    billing_api_fixture,
) -> None:
    request, owner, _, fake, harness = billing_api_fixture
    await _start_checkout(request, owner)
    original_key = fake.checkout_calls[0]["idempotency_key"]

    active_payload = b"original-active"
    fake.events[active_payload] = subscription_event(
        event_id="evt_original_active", created=200, user_id=owner.id
    )
    assert (await _webhook(request, owner, active_payload)).status_code == 200

    deleted_payload = b"original-deleted"
    fake.events[deleted_payload] = subscription_event(
        event_id="evt_original_deleted",
        created=300,
        user_id=owner.id,
        status="canceled",
        event_type="customer.subscription.deleted",
    )
    assert (await _webhook(request, owner, deleted_payload)).status_code == 200
    fake.open_sessions.clear()

    replacement_checkout = await request(owner, "post", "/api/billing/checkout-session")
    assert replacement_checkout.status_code == 200, replacement_checkout.text
    assert fake.checkout_calls[-1]["idempotency_key"] != original_key
    fake.open_sessions.clear()

    replacement_payload = b"replacement-active"
    fake.events[replacement_payload] = subscription_event(
        event_id="evt_replacement_active",
        created=400,
        user_id=owner.id,
        subscription_id="sub_replacement",
    )
    assert (await _webhook(request, owner, replacement_payload)).status_code == 200

    status = (await request(owner, "get", "/api/billing/status")).json()
    assert status["plan"] == "pro"
    assert status["stripe_subscription_id"] == "sub_replacement"
    row = await _subscription_row(harness, owner.id)
    assert row.superseded_subscription_ids == ["sub_owner"]

    stale_payload = b"superseded-stale"
    fake.events[stale_payload] = subscription_event(
        event_id="evt_superseded_stale",
        created=999,
        user_id=owner.id,
        subscription_id="sub_owner",
    )
    assert (await _webhook(request, owner, stale_payload)).status_code == 200
    unchanged = (await request(owner, "get", "/api/billing/status")).json()
    assert unchanged["stripe_subscription_id"] == "sub_replacement"
    assert unchanged["plan"] == "pro"


async def test_tenants_cannot_see_each_others_billing_state(billing_api_fixture) -> None:
    request, owner, other, _, _ = billing_api_fixture
    await request(owner, "post", "/api/billing/checkout-session")
    other_status = await request(other, "get", "/api/billing/status")
    assert other_status.status_code == 200
    assert other_status.json()["stripe_customer_id"] is None
    assert other_status.json()["plan"] == "free"


async def test_portal_requires_customer_then_uses_server_return_url(billing_api_fixture) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    missing = await request(owner, "post", "/api/billing/portal-session")
    assert missing.status_code == 409
    await request(owner, "post", "/api/billing/checkout-session")
    response = await request(owner, "post", "/api/billing/portal-session")
    assert response.status_code == 200
    assert response.json()["url"] == "https://billing.stripe.com/p/session/test"
    assert fake.portal_calls == [{
        "customer_id": "cus_test_owner",
        "return_url": "http://localhost:5173/billing",
    }]


async def test_webhook_rejects_invalid_signature(billing_api_fixture) -> None:
    request, owner, _, _, _ = billing_api_fixture
    response = await request(
        owner,
        "post",
        "/api/billing/webhook",
        content=b"invalid",
        headers={"stripe-signature": "wrong"},
    )
    assert response.status_code == 400


async def test_verified_webhook_sets_pro_and_duplicate_is_idempotent(billing_api_fixture) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    await _start_checkout(request, owner)
    payload = b"active-event"
    fake.events[payload] = subscription_event(event_id="evt_active", created=200, user_id=owner.id)

    first = await _webhook(request, owner, payload)
    second = await _webhook(request, owner, payload)
    assert first.status_code == 200, first.text
    assert first.json() == {"received": True, "duplicate": False}
    assert second.status_code == 200, second.text
    assert second.json() == {"received": True, "duplicate": True}

    status = (await request(owner, "get", "/api/billing/status")).json()
    assert status["plan"] == "pro"
    assert status["status"] == "active"
    assert status["stripe_subscription_id"] == "sub_owner"


async def test_older_webhook_cannot_regress_subscription_state(billing_api_fixture) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    await _start_checkout(request, owner)
    newer = b"newer"
    older = b"older"
    fake.events[newer] = subscription_event(event_id="evt_new", created=200, user_id=owner.id, status="active")
    fake.events[older] = subscription_event(event_id="evt_old", created=100, user_id=owner.id, status="canceled")

    await _webhook(request, owner, newer)
    old_response = await _webhook(request, owner, older)
    assert old_response.status_code == 200
    status = (await request(owner, "get", "/api/billing/status")).json()
    assert status["status"] == "active"
    assert status["plan"] == "pro"


async def test_webhook_grants_pro_only_for_configured_price(billing_api_fixture) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    await _start_checkout(request, owner)
    payload = b"wrong-price"
    fake.events[payload] = subscription_event(
        event_id="evt_wrong", created=200, user_id=owner.id, status="active", price_id="price_other"
    )
    response = await _webhook(request, owner, payload)
    assert response.status_code == 200, response.text
    status = (await request(owner, "get", "/api/billing/status")).json()
    # An unknown Price is not part of this product and is never bound locally.
    assert status["status"] == "free"
    assert status["plan"] == "free"
    assert status["stripe_subscription_id"] is None


async def test_webhook_ignores_metadata_user_mismatch(billing_api_fixture) -> None:
    request, owner, other, fake, _ = billing_api_fixture
    await _start_checkout(request, owner)
    payload = b"mismatch"
    # The event resolves to owner's row by customer id, but its metadata claims a
    # different tenant. It must not grant against either tenant.
    fake.events[payload] = subscription_event(
        event_id="evt_mismatch", created=200, user_id=other.id, status="active"
    )
    response = await _webhook(request, owner, payload)
    assert response.status_code == 200, response.text
    assert (await request(owner, "get", "/api/billing/status")).json()["plan"] == "free"
    assert (await request(other, "get", "/api/billing/status")).json()["plan"] == "free"


async def test_webhook_owner_mapping_race_is_retryable_then_converges(billing_api_fixture) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    payload = b"orphan"
    fake.events[payload] = subscription_event(event_id="evt_race", created=200, user_id=owner.id, status="active")

    # No checkout yet: the owner mapping does not exist. A valid event must be
    # asked to redeliver, never durably acknowledged, and never mint a tenant.
    early = await _webhook(request, owner, payload)
    assert early.status_code == 503
    orphan_status = (await request(owner, "get", "/api/billing/status")).json()
    assert orphan_status["plan"] == "free"
    assert orphan_status["stripe_customer_id"] is None

    # Once Checkout has committed the mapping, the redelivered event converges.
    await _start_checkout(request, owner)
    redelivered = await _webhook(request, owner, payload)
    assert redelivered.status_code == 200, redelivered.text
    status = (await request(owner, "get", "/api/billing/status")).json()
    assert status["plan"] == "pro"
    assert status["status"] == "active"


async def test_webhook_rejects_livemode_mismatch(billing_api_fixture) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    await _start_checkout(request, owner)
    payload = b"livemode"
    fake.events[payload] = subscription_event(
        event_id="evt_live", created=200, user_id=owner.id, status="active", livemode=True
    )
    response = await _webhook(request, owner, payload)
    assert response.status_code == 400
    assert (await request(owner, "get", "/api/billing/status")).json()["plan"] == "free"


async def test_webhook_rejects_missing_or_non_bool_livemode(billing_api_fixture) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    await _start_checkout(request, owner)
    payload = b"nonbool-livemode"
    event = subscription_event(event_id="evt_nonbool", created=200, user_id=owner.id, status="active")
    event["livemode"] = "false"  # a string, not a real boolean
    fake.events[payload] = event
    response = await _webhook(request, owner, payload)
    assert response.status_code == 400
    assert (await request(owner, "get", "/api/billing/status")).json()["plan"] == "free"


async def test_webhook_rejects_oversized_chunked_body(billing_api_fixture) -> None:
    request, owner, _, _, _ = billing_api_fixture

    async def oversized_chunks():
        chunk = b"x" * (256 * 1024)
        # Stream just over 1 MiB without any Content-Length header.
        for _ in range(5):
            yield chunk

    response = await request(
        owner,
        "post",
        "/api/billing/webhook",
        content=oversized_chunks(),
        headers={"stripe-signature": "valid-signature"},
    )
    assert response.status_code == 413


async def test_webhook_reconciles_to_current_subscription_state(billing_api_fixture) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    await _start_checkout(request, owner)
    # Stripe's authoritative current state is active on the configured price...
    fake.subscription_state["sub_owner"] = {
        "id": "sub_owner",
        "customer": "cus_test_owner",
        "status": "active",
        "cancel_at_period_end": False,
        "current_period_end": 1_800_000_000,
        "metadata": {"user_id": owner.id},
        "items": {"data": [{"price": {"id": "price_test_pro"}}]},
    }
    # ...even though this particular event object is a stale "incomplete" snapshot.
    payload = b"stale"
    fake.events[payload] = subscription_event(
        event_id="evt_stale", created=200, user_id=owner.id, status="incomplete"
    )
    response = await _webhook(request, owner, payload)
    assert response.status_code == 200, response.text
    status = (await request(owner, "get", "/api/billing/status")).json()
    assert status["plan"] == "pro"
    assert status["status"] == "active"


async def test_deleted_event_uses_snapshot_and_survives_older_update(billing_api_fixture) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    await _start_checkout(request, owner)
    deleted = b"deleted"
    stale_update = b"stale-update"
    fake.events[deleted] = subscription_event(
        event_id="evt_del",
        created=300,
        user_id=owner.id,
        status="canceled",
        event_type="customer.subscription.deleted",
    )
    fake.events[stale_update] = subscription_event(
        event_id="evt_old_update", created=200, user_id=owner.id, status="active"
    )

    # The deletion (newer) is terminal for this subscription.
    first = await _webhook(request, owner, deleted)
    assert first.status_code == 200, first.text
    # A late, older "active" update must not resurrect Pro.
    second = await _webhook(request, owner, stale_update)
    assert second.status_code == 200, second.text
    status = (await request(owner, "get", "/api/billing/status")).json()
    assert status["status"] == "canceled"
    assert status["plan"] == "free"


async def test_deleted_event_wins_over_update_with_same_second_timestamp(
    billing_api_fixture,
) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    await _start_checkout(request, owner)
    deleted = b"deleted-same-second"
    update = b"update-same-second"
    fake.events[deleted] = subscription_event(
        event_id="evt_del_same",
        created=300,
        user_id=owner.id,
        status="canceled",
        event_type="customer.subscription.deleted",
    )
    fake.events[update] = subscription_event(
        event_id="evt_update_same", created=300, user_id=owner.id, status="active"
    )

    assert (await _webhook(request, owner, deleted)).status_code == 200
    assert (await _webhook(request, owner, update)).status_code == 200
    status = (await request(owner, "get", "/api/billing/status")).json()
    assert status["status"] == "canceled"
    assert status["plan"] == "free"


async def test_retrieved_subscription_requires_exact_user_metadata(
    billing_api_fixture,
) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    await _start_checkout(request, owner)
    fake.subscription_state["sub_owner"] = {
        "id": "sub_owner",
        "customer": "cus_test_owner",
        "status": "active",
        "cancel_at_period_end": False,
        "current_period_end": 1_800_000_000,
        "metadata": {},
        "items": {"data": [{"price": {"id": "price_test_pro"}}]},
    }
    payload = b"missing-owner-metadata"
    fake.events[payload] = subscription_event(
        event_id="evt_missing_metadata", created=300, user_id=owner.id
    )

    assert (await _webhook(request, owner, payload)).status_code == 200
    status = (await request(owner, "get", "/api/billing/status")).json()
    assert status["plan"] == "free"


async def test_enforcement_blocks_free_and_allows_verified_pro(
    billing_api_fixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    request, owner, _, fake, _ = billing_api_fixture
    monkeypatch.setattr(app_settings, "billing_enforcement_enabled", True)
    await _start_checkout(request, owner)

    blocked = await request(
        owner,
        "post",
        "/api/invoices/generate",
        json={"prompt": "Create an invoice for one hour of design work"},
    )
    assert blocked.status_code == 402
    assert "Pro subscription" in blocked.json()["detail"]

    payload = b"entitled"
    fake.events[payload] = subscription_event(
        event_id="evt_entitled", created=300, user_id=owner.id, status="active"
    )
    await _webhook(request, owner, payload)
    allowed = await request(
        owner,
        "post",
        "/api/invoices/generate",
        json={"prompt": "Create an invoice for one hour of design work"},
    )
    assert allowed.status_code == 200, allowed.text
