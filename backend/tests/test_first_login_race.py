"""The requests fired right after email confirmation may race to create the user's rows.

Skipped unless TEST_DATABASE_URL points at a disposable PostgreSQL instance.
"""

from __future__ import annotations

import asyncio

import asyncpg

from tests.support.alembic_runner import upgrade_to_head
from tests.support.app_client import Tenant, api_client
from tests.support.postgres import asyncpg_dsn, bootstrap_supabase_stubs, scratch_database


async def test_concurrent_first_requests_create_one_profile_and_settings_row(tmp_path) -> None:
    async with scratch_database("ia_first_login") as url:
        await bootstrap_supabase_stubs(url)
        await upgrade_to_head(url)

        # A confirmed auth user with no profile yet, as right after signup.
        conn = await asyncpg.connect(asyncpg_dsn(url))
        try:
            user_id = str(await conn.fetchval("INSERT INTO auth.users (email) VALUES ('new@example.com') RETURNING id"))
        finally:
            await conn.close()
        tenant = Tenant(id=user_id, email="new@example.com")

        async with api_client(url, {"new": tenant}, tmp_path / "data") as (request, _harness):
            responses = await asyncio.gather(
                request(tenant, "get", "/api/auth/me"),
                request(tenant, "get", "/api/auth/me"),
                request(tenant, "get", "/api/settings"),
                request(tenant, "get", "/api/settings"),
            )

        assert [r.status_code for r in responses] == [200, 200, 200, 200], [r.text for r in responses]
        conn = await asyncpg.connect(asyncpg_dsn(url))
        try:
            assert await conn.fetchval("SELECT count(*) FROM public.profiles WHERE id = $1::uuid", user_id) == 1
            assert await conn.fetchval("SELECT count(*) FROM public.business_settings WHERE user_id = $1::uuid", user_id) == 1
        finally:
            await conn.close()
