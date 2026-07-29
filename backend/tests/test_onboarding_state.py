"""Onboarding completion state on tenant BusinessSettings.

A newly auto-created settings row is "incomplete" (``onboarding_completed_at``
is null). ``PUT /api/settings`` with ``onboarding_completed=true`` stamps the
timestamp *server-side* -- clients cannot supply an arbitrary time -- and
``onboarding_completed=false`` clears it so a tenant can reset/retest.

The fast tests exercise the Pydantic schema directly. The API-level tests at the
bottom run over the real API against a disposable loopback PostgreSQL and are
skipped unless TEST_DATABASE_URL is set.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.models.schemas import BusinessSettingsRead, BusinessSettingsUpdate

# ---------------------------------------------------------------------------
# Schema shape
# ---------------------------------------------------------------------------


def test_read_defaults_to_incomplete_for_a_fresh_row() -> None:
    row = BusinessSettingsRead(id=1, user_id="user-1")
    assert row.onboarding_completed_at is None
    assert row.onboarding_completed is False


def test_read_reports_completed_when_timestamp_present() -> None:
    row = BusinessSettingsRead(
        id=1,
        user_id="user-1",
        onboarding_completed_at=datetime(2026, 7, 26, 12, 0, tzinfo=timezone.utc),
    )
    assert row.onboarding_completed is True


def test_update_accepts_onboarding_completed_flag() -> None:
    assert BusinessSettingsUpdate(onboarding_completed=True).onboarding_completed is True
    assert BusinessSettingsUpdate(onboarding_completed=False).onboarding_completed is False


def test_update_leaves_onboarding_unset_by_default() -> None:
    update = BusinessSettingsUpdate()
    assert "onboarding_completed" not in update.model_dump(exclude_unset=True)


def test_update_does_not_expose_a_direct_timestamp_write() -> None:
    # Clients must not be able to backdate/forge the completion time.
    update = BusinessSettingsUpdate(onboarding_completed_at="2000-01-01T00:00:00Z")
    assert "onboarding_completed_at" not in update.model_dump(exclude_unset=True)


# ---------------------------------------------------------------------------
# API-level behaviour (requires a real PostgreSQL instance)
# ---------------------------------------------------------------------------

import pytest_asyncio  # noqa: E402

from tests.support.alembic_runner import run_alembic, upgrade_to_head  # noqa: E402
from tests.support.app_client import api_client, create_tenant  # noqa: E402
from tests.support.postgres import (  # noqa: E402
    asyncpg_dsn,
    bootstrap_supabase_stubs,
    scratch_database,
)


@pytest_asyncio.fixture
async def seeded_api(tmp_path):
    async with scratch_database("ia_onboarding") as url:
        await bootstrap_supabase_stubs(url)
        await upgrade_to_head(url)

        owner = await create_tenant(url, "onboarding-owner@example.com")
        async with api_client(url, {"owner": owner}, tmp_path / "data") as (request, harness):
            yield request, owner, harness


async def test_new_settings_row_is_incomplete(seeded_api) -> None:
    request, owner, _ = seeded_api

    response = await request(owner, "get", "/api/settings")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["onboarding_completed"] is False
    assert body["onboarding_completed_at"] is None


async def test_migration_completes_existing_tenants_but_not_future_rows() -> None:
    import asyncpg

    async with scratch_database("ia_onboarding_backfill") as url:
        await bootstrap_supabase_stubs(url)
        await run_alembic(url, "upgrade", "0008_email_templates")
        conn = await asyncpg.connect(asyncpg_dsn(url))
        try:
            existing_id = await conn.fetchval(
                "insert into auth.users(email) values('existing@example.com') returning id"
            )
            await conn.execute(
                "insert into public.profiles(id, email) values($1, 'existing@example.com')",
                existing_id,
            )
            await conn.execute(
                "insert into public.business_settings(user_id) values($1)",
                existing_id,
            )
            existing_without_settings_id = await conn.fetchval(
                "insert into auth.users(email) "
                "values('existing-without-settings@example.com') returning id"
            )
            await conn.execute(
                "insert into public.profiles(id, email) "
                "values($1, 'existing-without-settings@example.com')",
                existing_without_settings_id,
            )
        finally:
            await conn.close()

        await run_alembic(url, "upgrade", "0009_onboarding_state")
        conn = await asyncpg.connect(asyncpg_dsn(url))
        try:
            assert await conn.fetchval(
                "select onboarding_completed_at is not null "
                "from public.business_settings where user_id = $1",
                existing_id,
            )
            assert await conn.fetchval(
                "select onboarding_completed_at is not null "
                "from public.business_settings where user_id = $1",
                existing_without_settings_id,
            )
            new_id = await conn.fetchval(
                "insert into auth.users(email) values('new@example.com') returning id"
            )
            await conn.execute(
                "insert into public.profiles(id, email) values($1, 'new@example.com')",
                new_id,
            )
            new_completion = await conn.fetchval(
                "insert into public.business_settings(user_id) values($1) "
                "returning onboarding_completed_at",
                new_id,
            )
            assert new_completion is None
        finally:
            await conn.close()


async def test_completing_onboarding_stamps_the_timestamp_server_side(seeded_api) -> None:
    request, owner, _ = seeded_api

    before = datetime.now(timezone.utc)
    response = await request(
        owner, "put", "/api/settings", json={"onboarding_completed": True}
    )
    after = datetime.now(timezone.utc)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["onboarding_completed"] is True
    stamped = datetime.fromisoformat(body["onboarding_completed_at"])
    assert stamped.tzinfo is not None
    assert before <= stamped <= after


async def test_client_cannot_supply_an_arbitrary_completion_timestamp(seeded_api) -> None:
    request, owner, _ = seeded_api

    forged = "2000-01-01T00:00:00+00:00"
    before = datetime.now(timezone.utc)
    response = await request(
        owner,
        "put",
        "/api/settings",
        json={"onboarding_completed": True, "onboarding_completed_at": forged},
    )

    assert response.status_code == 200, response.text
    stamped = datetime.fromisoformat(response.json()["onboarding_completed_at"])
    assert stamped != datetime.fromisoformat(forged)
    assert stamped >= before


async def test_completion_persists_on_read_back(seeded_api) -> None:
    request, owner, _ = seeded_api

    put = await request(owner, "put", "/api/settings", json={"onboarding_completed": True})
    stamped = put.json()["onboarding_completed_at"]

    refetched = await request(owner, "get", "/api/settings")
    assert refetched.status_code == 200, refetched.text
    body = refetched.json()
    assert body["onboarding_completed"] is True
    assert body["onboarding_completed_at"] == stamped


async def test_clearing_onboarding_resets_to_incomplete(seeded_api) -> None:
    request, owner, _ = seeded_api

    await request(owner, "put", "/api/settings", json={"onboarding_completed": True})

    cleared = await request(
        owner, "put", "/api/settings", json={"onboarding_completed": False}
    )
    assert cleared.status_code == 200, cleared.text
    body = cleared.json()
    assert body["onboarding_completed"] is False
    assert body["onboarding_completed_at"] is None

    refetched = await request(owner, "get", "/api/settings")
    assert refetched.json()["onboarding_completed"] is False
    assert refetched.json()["onboarding_completed_at"] is None


async def test_completing_onboarding_leaves_templates_intact(seeded_api) -> None:
    request, owner, _ = seeded_api

    await request(
        owner,
        "put",
        "/api/settings",
        json={"default_email_subject": "Custom {invoice_number}"},
    )
    await request(owner, "put", "/api/settings", json={"onboarding_completed": True})

    body = (await request(owner, "get", "/api/settings")).json()
    assert body["default_email_subject"] == "Custom {invoice_number}"
    assert body["onboarding_completed"] is True
