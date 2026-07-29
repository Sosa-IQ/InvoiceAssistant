"""Usage metering and pack freeze/credit behavior."""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.config import settings as app_settings
from app.models.db_models import Subscription
from app.services import usage_service
from tests.support.alembic_runner import upgrade_to_head
from tests.support.app_client import api_client, create_tenant
from tests.support.postgres import bootstrap_supabase_stubs, scratch_database


@pytest_asyncio.fixture
async def usage_api(tmp_path, monkeypatch: pytest.MonkeyPatch):
    async with scratch_database("ia_usage") as url:
        await bootstrap_supabase_stubs(url)
        await upgrade_to_head(url)
        owner = await create_tenant(url, "usage-owner@example.com")
        monkeypatch.setattr(app_settings, "billing_enforcement_enabled", True)
        monkeypatch.setattr(app_settings, "ai_monthly_token_limit", 1_000)
        monkeypatch.setattr(app_settings, "voice_monthly_seconds", 120)
        monkeypatch.setattr(app_settings, "global_daily_ai_budget_cents", 1_000_000)
        async with api_client(url, {"owner": owner}, tmp_path / "data") as (request, harness):
            yield request, owner, harness


async def _make_pro(harness, user_id: str) -> None:
    async with harness["session_factory"]() as session:
        existing = (
            await session.execute(select(Subscription).where(Subscription.user_id == user_id))
        ).scalar_one_or_none()
        if existing is None:
            session.add(
                Subscription(
                    user_id=user_id,
                    plan="pro",
                    status="active",
                    stripe_customer_id="cus_usage",
                    stripe_subscription_id="sub_usage",
                )
            )
        else:
            existing.plan = "pro"
            existing.status = "active"
        await session.commit()


@pytest.mark.asyncio
async def test_usage_status_and_token_consume(usage_api) -> None:
    request, owner, harness = usage_api
    await _make_pro(harness, owner.id)

    before = await request(owner, "get", "/api/billing/usage")
    assert before.status_code == 200, before.text
    body = before.json()
    assert body["pro_entitled"] is True
    assert body["ai_tokens_included"] == 1000
    assert body["ai_usage_ratio"] == 0.0

    async with harness["session_factory"]() as session:
        await usage_service.consume_ai_tokens(
            session,
            user_id=owner.id,
            tokens_in=400,
            tokens_out=100,
            request_id="req-1",
        )

    after = (await request(owner, "get", "/api/billing/usage")).json()
    assert after["ai_tokens_used"] == 500
    assert after["ai_tokens_remaining"] == 500
    assert after["ai_usage_ratio"] == pytest.approx(0.5)


@pytest.mark.asyncio
async def test_pack_balance_freezes_without_pro(usage_api) -> None:
    request, owner, harness = usage_api
    await _make_pro(harness, owner.id)

    async with harness["session_factory"]() as session:
        await usage_service.credit_pack_from_checkout(
            session,
            user_id=owner.id,
            pack_kind=usage_service.PACK_AI,
            checkout_session_id="cs_pack_1",
            payment_intent_id="pi_1",
        )
        await session.commit()

    pro_usage = (await request(owner, "get", "/api/billing/usage")).json()
    assert pro_usage["ai_tokens_pack_remaining"] == app_settings.ai_pack_tokens
    assert pro_usage["packs_frozen"] is False
    assert pro_usage["ai_tokens_remaining"] > pro_usage["ai_tokens_included"]

    async with harness["session_factory"]() as session:
        row = (
            await session.execute(select(Subscription).where(Subscription.user_id == owner.id))
        ).scalar_one()
        row.plan = "free"
        row.status = "canceled"
        await session.commit()

    free_usage = (await request(owner, "get", "/api/billing/usage")).json()
    assert free_usage["pro_entitled"] is False
    assert free_usage["ai_tokens_pack_remaining"] == app_settings.ai_pack_tokens
    assert free_usage["packs_frozen"] is True
    assert free_usage["ai_tokens_remaining"] == 0


@pytest.mark.asyncio
async def test_pack_checkout_requires_pro(usage_api, monkeypatch: pytest.MonkeyPatch) -> None:
    request, owner, _harness = usage_api
    monkeypatch.setattr(app_settings, "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(app_settings, "stripe_webhook_secret", "whsec_x")
    monkeypatch.setattr(app_settings, "stripe_pro_price_id", "price_pro")
    monkeypatch.setattr(app_settings, "stripe_ai_pack_price_id", "price_ai_pack")

    denied = await request(
        owner, "post", "/api/billing/pack-checkout-session", json={"pack": "ai_tokens"}
    )
    assert denied.status_code == 402, denied.text
