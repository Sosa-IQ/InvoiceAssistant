"""Two-user tenant isolation against a real PostgreSQL database.

Every test here seeds two fully-populated tenants through the real API, then
has the second tenant attempt to reach the first tenant's data. Isolation is
enforced by per-user filters in the route handlers and by the pgvector query
filter, and none of that is visible to a unit test with a mocked session --
so these run over HTTP against a migrated database with real SQL.

Skipped unless TEST_DATABASE_URL points at a disposable PostgreSQL instance
with pgvector; see docs/testing.md.
"""

from __future__ import annotations

import json

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

OTHER = "other tenant's row must be invisible"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def isolated_api(tmp_path):
    """Two seeded tenants sharing one migrated database."""
    async with scratch_database("ia_tenants") as url:
        await bootstrap_supabase_stubs(url)
        await upgrade_to_head(url)

        alice = await create_tenant(url, "alice@example.com")
        bob = await create_tenant(url, "bob@example.com")
        tenants = {"alice": alice, "bob": bob}

        async with api_client(url, tenants, tmp_path / "data") as (request, harness):
            await _seed(request, alice, "Alice")
            await _seed(request, bob, "Bob")
            yield request, alice, bob, harness, url


async def _seed(request, tenant: Tenant, label: str) -> None:
    """Populate one tenant with a row in every owned table, via the real API."""
    response = await request(
        tenant, "put", "/api/settings", json={"name": f"{label} Consulting", "email": tenant.email}
    )
    assert response.status_code == 200, response.text

    response = await request(
        tenant,
        "post",
        "/api/clients",
        json={"name": f"{label} Client", "email": f"client-{label.lower()}@example.com"},
    )
    assert response.status_code == 201, response.text
    client = response.json()
    tenant.client_id = client["id"]
    tenant.extras["client_code"] = client["client_code"]

    response = await request(
        tenant,
        "post",
        f"/api/clients/{tenant.client_id}/addresses",
        json={"label": "Head office", "address": f"{label} Street 1"},
    )
    assert response.status_code == 201, response.text
    tenant.address_id = response.json()["id"]

    response = await request(
        tenant,
        "post",
        "/api/catalog",
        json={"description": f"{label} secret service", "unit_price": 99.0, "unit": "hour"},
    )
    assert response.status_code == 201, response.text
    tenant.catalog_item_id = response.json()["id"]

    # Export renders a real PDF and creates the invoice record.
    response = await request(
        tenant,
        "post",
        "/api/invoices/export",
        json=_invoice_payload(tenant, label),
    )
    assert response.status_code == 200, response.text

    response = await request(tenant, "get", "/api/invoices")
    assert response.status_code == 200, response.text
    records = response.json()
    assert len(records) == 1
    tenant.invoice_record_id = records[0]["id"]
    tenant.extras["invoice_number"] = records[0]["invoice_number"]

    # Index into pgvector so embedding isolation is exercised.
    response = await request(tenant, "post", f"/api/invoices/{tenant.invoice_record_id}/index")
    assert response.status_code == 200, response.text
    tenant.rag_doc_id = response.json()["rag_doc_id"]

    # Send, so there is email history to leak.
    response = await request(
        tenant,
        "post",
        f"/api/invoices/{tenant.invoice_record_id}/send",
        json={"subject": f"{label} invoice", "message": f"{label} confidential message"},
    )
    assert response.status_code == 200, response.text
    tenant.email_history_id = response.json()["email"]["id"]


def _invoice_payload(tenant: Tenant, label: str) -> dict:
    return {
        "invoice_number": None,
        "issue_date": "2026-07-23",
        "status": "draft",
        "from": {"name": f"{label} Consulting", "email": tenant.email},
        "to": {
            "client_id": tenant.client_id,
            "name": f"{label} Client",
            "email": f"client-{label.lower()}@example.com",
        },
        "line_items": [
            {
                "description": f"{label} confidential engagement",
                "quantity": 2,
                "unit": "hour",
                "unit_price": 150,
                "subtotal": 300,
            }
        ],
        "totals": {"subtotal": 300, "grand_total": 300},
    }


# ---------------------------------------------------------------------------
# Business settings
# ---------------------------------------------------------------------------

async def test_settings_are_per_tenant(isolated_api) -> None:
    request, alice, bob, _, _ = isolated_api

    alice_settings = (await request(alice, "get", "/api/settings")).json()
    bob_settings = (await request(bob, "get", "/api/settings")).json()

    assert alice_settings["name"] == "Alice Consulting"
    assert bob_settings["name"] == "Bob Consulting"
    assert alice_settings["id"] != bob_settings["id"]
    assert alice_settings["user_id"] == alice.id
    assert bob_settings["user_id"] == bob.id


async def test_updating_settings_does_not_touch_the_other_tenant(isolated_api) -> None:
    request, alice, bob, _, _ = isolated_api

    response = await request(bob, "put", "/api/settings", json={"name": "Bob Overwrote It"})
    assert response.status_code == 200

    alice_settings = (await request(alice, "get", "/api/settings")).json()
    assert alice_settings["name"] == "Alice Consulting", OTHER


# ---------------------------------------------------------------------------
# Clients and addresses
# ---------------------------------------------------------------------------

async def test_client_list_only_returns_own_clients(isolated_api) -> None:
    request, alice, bob, _, _ = isolated_api

    listed = (await request(bob, "get", "/api/clients")).json()

    assert [c["id"] for c in listed] == [bob.client_id]
    assert all(c["user_id"] == bob.id for c in listed)


@pytest.mark.parametrize(
    ("method", "path_template", "payload", "expected"),
    [
        ("get", "/api/clients/{client_id}", None, 404),
        ("put", "/api/clients/{client_id}", {"name": "Hijacked"}, 404),
        ("delete", "/api/clients/{client_id}", None, 404),
        ("post", "/api/clients/{client_id}/addresses", {"address": "Injected St"}, 404),
        (
            "put",
            "/api/clients/{client_id}/addresses/{address_id}",
            {"label": "x", "address": "Injected St"},
            404,
        ),
        ("delete", "/api/clients/{client_id}/addresses/{address_id}", None, 404),
    ],
)
async def test_client_and_address_routes_reject_the_other_tenant(
    isolated_api, method: str, path_template: str, payload: dict | None, expected: int
) -> None:
    request, alice, bob, _, _ = isolated_api
    path = path_template.format(client_id=alice.client_id, address_id=alice.address_id)

    response = await request(bob, method, path, json=payload)

    assert response.status_code == expected, response.text


async def test_rejected_writes_leave_the_owner_data_intact(isolated_api) -> None:
    request, alice, bob, _, _ = isolated_api

    await request(bob, "put", f"/api/clients/{alice.client_id}", json={"name": "Hijacked"})
    await request(bob, "delete", f"/api/clients/{alice.client_id}")
    await request(bob, "delete", f"/api/clients/{alice.client_id}/addresses/{alice.address_id}")

    client = (await request(alice, "get", f"/api/clients/{alice.client_id}")).json()
    assert client["name"] == "Alice Client", OTHER
    assert [a["id"] for a in client["addresses"]] == [alice.address_id], OTHER


async def test_addresses_are_never_returned_to_the_other_tenant(isolated_api) -> None:
    request, alice, bob, _, _ = isolated_api

    listed = (await request(bob, "get", "/api/clients")).json()
    addresses = [a["address"] for c in listed for a in c["addresses"]]

    assert addresses == ["Bob Street 1"]
    assert "Alice Street 1" not in addresses, OTHER


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

async def test_catalog_is_scoped_to_the_owner(isolated_api) -> None:
    request, alice, bob, _, _ = isolated_api

    listed = (await request(bob, "get", "/api/catalog")).json()

    assert [item["id"] for item in listed] == [bob.catalog_item_id]
    assert "Alice secret service" not in [item["description"] for item in listed], OTHER


@pytest.mark.parametrize(
    ("method", "payload"),
    [("put", {"description": "Hijacked"}), ("delete", None)],
)
async def test_catalog_writes_reject_the_other_tenant(
    isolated_api, method: str, payload: dict | None
) -> None:
    request, alice, bob, _, _ = isolated_api

    response = await request(
        bob, method, f"/api/catalog/{alice.catalog_item_id}", json=payload
    )

    assert response.status_code == 404, response.text

    still_there = (await request(alice, "get", "/api/catalog")).json()
    assert still_there[0]["description"] == "Alice secret service", OTHER


# ---------------------------------------------------------------------------
# Invoice records and PDFs
# ---------------------------------------------------------------------------

async def test_invoice_list_is_scoped_to_the_owner(isolated_api) -> None:
    request, alice, bob, _, _ = isolated_api

    listed = (await request(bob, "get", "/api/invoices")).json()

    assert [r["id"] for r in listed] == [bob.invoice_record_id]
    assert all(r["user_id"] == bob.id for r in listed)


@pytest.mark.parametrize("suffix", ["/pdf", "/download"])
async def test_pdfs_are_not_served_to_the_other_tenant(isolated_api, suffix: str) -> None:
    request, alice, bob, _, _ = isolated_api

    response = await request(bob, "get", f"/api/invoices/{alice.invoice_record_id}{suffix}")

    assert response.status_code == 404, response.text
    assert b"%PDF" not in response.content, "another tenant's PDF bytes were served"


async def test_owner_can_still_download_their_own_pdf(isolated_api) -> None:
    """The isolation checks above must not be passing for the wrong reason."""
    request, alice, _, _, _ = isolated_api

    response = await request(alice, "get", f"/api/invoices/{alice.invoice_record_id}/download")

    assert response.status_code == 200
    assert response.content.startswith(b"%PDF-")


# ---------------------------------------------------------------------------
# Embeddings / RAG
# ---------------------------------------------------------------------------

async def _stored_chunk(url: str, tenant: Tenant) -> str:
    conn = await asyncpg.connect(asyncpg_dsn(url))
    try:
        return await conn.fetchval(
            "SELECT content FROM public.invoice_embeddings WHERE user_id = $1::uuid "
            "ORDER BY chunk_index LIMIT 1",
            tenant.id,
        )
    finally:
        await conn.close()


async def test_rag_context_never_includes_the_other_tenants_invoices(isolated_api) -> None:
    """A prompt that matches both tenants' invoices must retrieve only one.

    The two seeded invoices are near-identical apart from the tenant name, so
    querying with one tenant's own indexed text is close enough to retrieve the
    other tenant's chunk as well if the pgvector filter is ever dropped.
    """
    request, alice, bob, harness, url = isolated_api
    prompt = await _stored_chunk(url, bob)

    response = await request(bob, "post", "/api/invoices/generate", json={"prompt": prompt})
    assert response.status_code == 200, response.text

    rag_context = harness["openai"].generate_calls[-1]["rag_context"]

    # Positive control: without this, the assertions below pass vacuously
    # whenever retrieval returns nothing at all.
    assert "Bob confidential engagement" in rag_context, (
        "retrieval returned nothing, so this test cannot detect a leak"
    )
    assert rag_context.count("[Document") == 1, "more than one tenant's document was retrieved"
    assert "Alice confidential engagement" not in rag_context, OTHER
    assert "Alice Client" not in rag_context, OTHER
    assert "alice@example.com" not in rag_context, OTHER


async def test_generation_context_only_contains_own_clients_and_catalog(isolated_api) -> None:
    request, alice, bob, harness, _ = isolated_api

    await request(bob, "post", "/api/invoices/generate", json={"prompt": "anything"})
    call = harness["openai"].generate_calls[-1]

    client_ids = [c["id"] for c in call["client_context"]]
    catalog_ids = [item["id"] for item in call["catalog_context"]]

    assert client_ids == [bob.client_id], OTHER
    assert catalog_ids == [bob.catalog_item_id], OTHER


async def test_embedding_rows_are_stored_with_their_owner(isolated_api) -> None:
    request, alice, bob, _, url = isolated_api

    conn = await asyncpg.connect(asyncpg_dsn(url))
    try:
        rows = await conn.fetch(
            "SELECT user_id, content FROM public.invoice_embeddings ORDER BY user_id"
        )
    finally:
        await conn.close()

    assert rows, "indexing stored no embeddings"
    for row in rows:
        owner = "Alice" if str(row["user_id"]) == alice.id else "Bob"
        assert owner in row["content"], "an embedding was attributed to the wrong tenant"


async def test_indexing_another_tenants_invoice_is_rejected(isolated_api) -> None:
    request, alice, bob, _, url = isolated_api

    response = await request(bob, "post", f"/api/invoices/{alice.invoice_record_id}/index")

    assert response.status_code == 404, response.text

    conn = await asyncpg.connect(asyncpg_dsn(url))
    try:
        count = await conn.fetchval(
            "SELECT count(*) FROM public.invoice_embeddings WHERE user_id = $1::uuid", bob.id
        )
        alice_chunks = await conn.fetchval(
            "SELECT count(*) FROM public.invoice_embeddings WHERE user_id = $1::uuid", alice.id
        )
    finally:
        await conn.close()

    assert alice_chunks > 0, "the owner's vectors must be untouched"
    assert count > 0


# ---------------------------------------------------------------------------
# Email history
# ---------------------------------------------------------------------------

async def test_email_history_is_scoped_to_the_owner(isolated_api) -> None:
    request, alice, bob, _, _ = isolated_api

    own = (await request(bob, "get", f"/api/invoices/{bob.invoice_record_id}/emails")).json()

    assert [e["id"] for e in own] == [bob.email_history_id]
    assert own[0]["message_body"] == "Bob confidential message"


async def test_email_history_of_another_tenant_is_not_readable(isolated_api) -> None:
    request, alice, bob, _, _ = isolated_api

    response = await request(bob, "get", f"/api/invoices/{alice.invoice_record_id}/emails")

    assert response.status_code == 404, response.text
    assert "Alice confidential message" not in response.text, OTHER


async def test_sending_another_tenants_invoice_is_rejected(isolated_api) -> None:
    request, alice, bob, harness, _ = isolated_api
    before = len(harness["emails"].sent)

    response = await request(
        bob,
        "post",
        f"/api/invoices/{alice.invoice_record_id}/send",
        json={"subject": "Hijack", "message": "Please pay me instead."},
    )

    assert response.status_code == 404, response.text
    assert len(harness["emails"].sent) == before, "an email was sent for another tenant's invoice"


# ---------------------------------------------------------------------------
# Invoice numbering
# ---------------------------------------------------------------------------

async def test_invoice_numbering_sequences_are_independent_per_tenant(isolated_api) -> None:
    """Both tenants seeded one invoice, so both must be on sequence 2 next."""
    request, alice, bob, _, _ = isolated_api

    alice_next = (
        await request(alice, "get", f"/api/invoices/next-number?client_id={alice.client_id}")
    ).json()
    bob_next = (
        await request(bob, "get", f"/api/invoices/next-number?client_id={bob.client_id}")
    ).json()

    assert alice_next["client_invoice_sequence"] == 2
    assert bob_next["client_invoice_sequence"] == 2, (
        "one tenant's invoices advanced another tenant's sequence"
    )


async def test_numbering_does_not_advance_when_the_other_tenant_exports(isolated_api) -> None:
    request, alice, bob, _, _ = isolated_api

    for _ in range(3):
        response = await request(bob, "post", "/api/invoices/export", json=_invoice_payload(bob, "Bob"))
        assert response.status_code == 200, response.text

    alice_next = (
        await request(alice, "get", f"/api/invoices/next-number?client_id={alice.client_id}")
    ).json()

    assert alice_next["client_invoice_sequence"] == 2, (
        "another tenant's exports leaked into this tenant's numbering"
    )


async def test_next_number_for_another_tenants_client_is_rejected(isolated_api) -> None:
    request, alice, bob, _, _ = isolated_api

    response = await request(
        bob, "get", f"/api/invoices/next-number?client_id={alice.client_id}"
    )

    assert response.status_code == 404, response.text


async def test_export_against_another_tenants_client_is_rejected(isolated_api) -> None:
    request, alice, bob, _, url = isolated_api
    payload = _invoice_payload(bob, "Bob")
    payload["to"]["client_id"] = alice.client_id

    response = await request(bob, "post", "/api/invoices/export", json=payload)

    assert response.status_code == 422, response.text

    conn = await asyncpg.connect(asyncpg_dsn(url))
    try:
        count = await conn.fetchval(
            "SELECT count(*) FROM public.invoice_records WHERE client_id = $1", alice.client_id
        )
    finally:
        await conn.close()
    assert count == 1, "an invoice was attached to another tenant's client"


# ---------------------------------------------------------------------------
# Destructive operations
# ---------------------------------------------------------------------------

async def test_deleting_another_tenants_invoice_is_rejected_and_preserves_everything(
    isolated_api,
) -> None:
    request, alice, bob, _, url = isolated_api

    response = await request(bob, "delete", f"/api/invoices/{alice.invoice_record_id}")
    assert response.status_code == 404, response.text

    record = (await request(alice, "get", "/api/invoices")).json()
    assert [r["id"] for r in record] == [alice.invoice_record_id], OTHER

    pdf = await request(alice, "get", f"/api/invoices/{alice.invoice_record_id}/download")
    assert pdf.status_code == 200, "the owner's PDF was deleted by another tenant"

    conn = await asyncpg.connect(asyncpg_dsn(url))
    try:
        chunks = await conn.fetchval(
            "SELECT count(*) FROM public.invoice_embeddings WHERE user_id = $1::uuid", alice.id
        )
        emails = await conn.fetchval(
            "SELECT count(*) FROM public.invoice_emails WHERE user_id = $1::uuid", alice.id
        )
    finally:
        await conn.close()

    assert chunks > 0, "the owner's vectors were deleted by another tenant"
    assert emails == 1, "the owner's email history was deleted by another tenant"


async def test_deleting_own_invoice_removes_only_own_vectors(isolated_api) -> None:
    request, alice, bob, _, url = isolated_api

    response = await request(bob, "delete", f"/api/invoices/{bob.invoice_record_id}")
    assert response.status_code == 204, response.text

    conn = await asyncpg.connect(asyncpg_dsn(url))
    try:
        bob_chunks = await conn.fetchval(
            "SELECT count(*) FROM public.invoice_embeddings WHERE user_id = $1::uuid", bob.id
        )
        alice_chunks = await conn.fetchval(
            "SELECT count(*) FROM public.invoice_embeddings WHERE user_id = $1::uuid", alice.id
        )
    finally:
        await conn.close()

    assert bob_chunks == 0
    assert alice_chunks > 0, "deleting one tenant's invoice removed another tenant's vectors"


async def test_deleting_a_client_cascades_only_within_the_owner(isolated_api) -> None:
    request, alice, bob, _, url = isolated_api

    response = await request(bob, "delete", f"/api/clients/{bob.client_id}")
    assert response.status_code == 204, response.text

    alice_client = await request(alice, "get", f"/api/clients/{alice.client_id}")
    assert alice_client.status_code == 200
    assert [a["id"] for a in alice_client.json()["addresses"]] == [alice.address_id], OTHER

    conn = await asyncpg.connect(asyncpg_dsn(url))
    try:
        remaining = await conn.fetchval(
            "SELECT count(*) FROM public.client_addresses WHERE user_id = $1::uuid", alice.id
        )
    finally:
        await conn.close()
    assert remaining == 1, "another tenant's addresses were cascaded away"


# ---------------------------------------------------------------------------
# Stored ownership
# ---------------------------------------------------------------------------

async def test_every_owned_table_records_the_creating_tenant(isolated_api) -> None:
    """No row may be written without an owner, in any owned table."""
    request, alice, bob, _, url = isolated_api

    tables = (
        "business_settings",
        "clients",
        "client_addresses",
        "catalog_items",
        "invoice_records",
        "invoice_embeddings",
        "invoice_emails",
    )

    conn = await asyncpg.connect(asyncpg_dsn(url))
    try:
        for table in tables:
            total = await conn.fetchval(f"SELECT count(*) FROM public.{table}")
            owned = await conn.fetchval(
                f"SELECT count(*) FROM public.{table} WHERE user_id = ANY($1::uuid[])",
                [alice.id, bob.id],
            )
            assert total > 0, f"{table} was never populated, so this proves nothing"
            assert owned == total, f"{table} contains rows with no or unknown owner"
    finally:
        await conn.close()


async def test_invoice_json_of_one_tenant_never_names_the_other(isolated_api) -> None:
    request, alice, bob, _, _ = isolated_api

    listed = (await request(bob, "get", "/api/invoices")).json()
    blob = json.dumps(listed)

    assert "Alice" not in blob, OTHER
