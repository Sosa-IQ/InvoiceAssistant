"""Failed sends stay in the database but are hidden from the invoice's history.

Runs over the real API against a disposable loopback PostgreSQL, reusing the
hermetic app_client fakes (OpenAI, SMTP, Supabase Storage). Skipped unless
TEST_DATABASE_URL is set; see docs/testing.md.
"""

from __future__ import annotations

import asyncpg
import pytest
import pytest_asyncio

from tests.support.app_client import Tenant, api_client, create_tenant
from tests.support.postgres import (
    asyncpg_dsn,
    bootstrap_supabase_stubs,
    scratch_database,
)
from tests.support.alembic_runner import upgrade_to_head


@pytest_asyncio.fixture
async def seeded_api(tmp_path):
    async with scratch_database("ia_email_history") as url:
        await bootstrap_supabase_stubs(url)
        await upgrade_to_head(url)

        owner = await create_tenant(url, "owner@example.com")
        tenants = {"owner": owner}

        async with api_client(url, tenants, tmp_path / "data") as (request, harness):
            await _seed_exported_invoice(request, owner)
            yield request, owner, harness, url


async def _seed_exported_invoice(request, tenant: Tenant) -> None:
    response = await request(
        tenant, "put", "/api/settings", json={"name": "Owner Consulting", "email": tenant.email}
    )
    assert response.status_code == 200, response.text

    response = await request(
        tenant,
        "post",
        "/api/clients",
        json={"name": "Owner Client", "email": "client@example.com"},
    )
    assert response.status_code == 201, response.text
    tenant.client_id = response.json()["id"]

    response = await request(
        tenant,
        "post",
        "/api/invoices/export",
        json={
            "invoice_number": None,
            "issue_date": "2026-07-23",
            "status": "draft",
            "from": {"name": "Owner Consulting", "email": tenant.email},
            "to": {
                "client_id": tenant.client_id,
                "name": "Owner Client",
                "email": "client@example.com",
            },
            "line_items": [
                {"description": "Work", "quantity": 1, "unit": "item", "unit_price": 10, "subtotal": 10}
            ],
            "totals": {"subtotal": 10, "grand_total": 10},
        },
    )
    assert response.status_code == 200, response.text

    records = (await request(tenant, "get", "/api/invoices")).json()
    tenant.invoice_record_id = records[0]["id"]


async def test_email_history_excludes_failed_sends(seeded_api) -> None:
    request, owner, harness, url = seeded_api
    from app.api import invoices as invoices_api

    # One genuine (faked) success.
    ok = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json={"subject": "Owner invoice", "message": "Please see attached."},
    )
    assert ok.status_code == 200, ok.text

    # Force the next send to fail, so a "failed" row is persisted.
    async def boom(**kwargs):
        raise RuntimeError("smtp exploded")

    original = invoices_api.email_svc.send_invoice_email
    invoices_api.email_svc.send_invoice_email = boom
    try:
        bad = await request(
            owner,
            "post",
            f"/api/invoices/{owner.invoice_record_id}/send",
            json={"subject": "Owner invoice retry", "message": "Trying again."},
        )
    finally:
        invoices_api.email_svc.send_invoice_email = original
    assert bad.status_code == 502, bad.text

    history = (await request(owner, "get", f"/api/invoices/{owner.invoice_record_id}/emails")).json()
    assert [e["status"] for e in history] == ["sent"], history
    assert all(e["status"] != "failed" for e in history)

    # The failed row is still persisted for audit/observability.
    conn = await asyncpg.connect(asyncpg_dsn(url))
    try:
        total = await conn.fetchval(
            "SELECT count(*) FROM public.invoice_emails WHERE invoice_record_id = $1",
            owner.invoice_record_id,
        )
        failed = await conn.fetchval(
            "SELECT count(*) FROM public.invoice_emails "
            "WHERE invoice_record_id = $1 AND status = 'failed'",
            owner.invoice_record_id,
        )
    finally:
        await conn.close()
    assert total == 2
    assert failed == 1
