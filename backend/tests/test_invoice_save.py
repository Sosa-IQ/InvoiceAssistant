"""`POST /api/invoices/save` persists an exported record and returns it as JSON.

Runs over the real API against a disposable loopback PostgreSQL, reusing the
hermetic app_client fakes. Skipped unless TEST_DATABASE_URL is set.
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
    async with scratch_database("ia_invoice_save") as url:
        await bootstrap_supabase_stubs(url)
        await upgrade_to_head(url)

        owner = await create_tenant(url, "owner@example.com")
        async with api_client(url, {"owner": owner}, tmp_path / "data") as (request, harness):
            await _seed_client(request, owner)
            yield request, owner, harness, url


async def _seed_client(request, tenant: Tenant) -> None:
    response = await request(
        tenant, "put", "/api/settings", json={"name": "Owner Consulting", "email": tenant.email}
    )
    assert response.status_code == 200, response.text
    response = await request(
        tenant, "post", "/api/clients", json={"name": "Owner Client", "email": "client@example.com"}
    )
    assert response.status_code == 201, response.text
    tenant.client_id = response.json()["id"]


def _payload(tenant: Tenant) -> dict:
    return {
        "invoice_number": None,
        "issue_date": "2026-07-23",
        "status": "draft",
        "from": {"name": "Owner Consulting", "email": tenant.email},
        "to": {"client_id": tenant.client_id, "name": "Owner Client", "email": "client@example.com"},
        "line_items": [
            {"description": "Work", "quantity": 2, "unit": "hour", "unit_price": 50, "subtotal": 100}
        ],
        "totals": {"subtotal": 100, "grand_total": 100},
    }


async def test_save_persists_exported_record_and_returns_json(seeded_api) -> None:
    request, owner, _, url = seeded_api

    response = await request(owner, "post", "/api/invoices/save", json=_payload(owner))
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["status"] == "exported"
    assert body["invoice_number"], body
    assert body["invoice_json"], body
    assert body["client_id"] == owner.client_id
    assert body["source"] == "generated"

    conn = await asyncpg.connect(asyncpg_dsn(url))
    try:
        row = await conn.fetchrow(
            "SELECT status, invoice_number, invoice_json FROM public.invoice_records WHERE id = $1",
            body["id"],
        )
    finally:
        await conn.close()
    assert row["status"] == "exported"
    assert row["invoice_number"] == body["invoice_number"]
    assert row["invoice_json"]


async def test_save_requires_selected_client(seeded_api) -> None:
    request, owner, _, _ = seeded_api
    payload = _payload(owner)
    payload["to"]["client_id"] = None

    response = await request(owner, "post", "/api/invoices/save", json=payload)
    assert response.status_code == 422, response.text


async def test_export_still_streams_pdf_and_upserts(seeded_api) -> None:
    request, owner, _, url = seeded_api

    response = await request(owner, "post", "/api/invoices/export", json=_payload(owner))
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.content[:4] == b"%PDF"

    conn = await asyncpg.connect(asyncpg_dsn(url))
    try:
        count = await conn.fetchval(
            "SELECT count(*) FROM public.invoice_records WHERE user_id = $1::uuid AND status = 'exported'",
            owner.id,
        )
    finally:
        await conn.close()
    assert count == 1


async def test_save_cannot_move_an_existing_invoice_to_another_client(seeded_api) -> None:
    request, owner, _, url = seeded_api
    first = await request(owner, "post", "/api/invoices/save", json=_payload(owner))
    assert first.status_code == 200, first.text
    first_body = first.json()

    second_client = await request(
        owner,
        "post",
        "/api/clients",
        json={"name": "Second Client", "email": "second@example.com"},
    )
    assert second_client.status_code == 201, second_client.text

    payload = _payload(owner)
    payload["invoice_number"] = first_body["invoice_number"]
    payload["to"]["client_id"] = second_client.json()["id"]
    payload["to"]["name"] = "Second Client"
    payload["to"]["email"] = "second@example.com"
    second = await request(owner, "post", "/api/invoices/save", json=payload)
    assert second.status_code == 200, second.text
    assert second.json()["id"] != first_body["id"]

    conn = await asyncpg.connect(asyncpg_dsn(url))
    try:
        rows = await conn.fetch(
            "SELECT id, client_id FROM public.invoice_records WHERE user_id = $1::uuid ORDER BY id",
            owner.id,
        )
    finally:
        await conn.close()
    assert len(rows) == 2
    assert rows[0]["id"] == first_body["id"]
    assert rows[0]["client_id"] == owner.client_id
    assert rows[1]["client_id"] == second_client.json()["id"]
