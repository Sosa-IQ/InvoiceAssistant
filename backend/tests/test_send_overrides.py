"""`POST /send` honors client-supplied From/Reply-To/Recipient/CC overrides.

Runs over the real API against a disposable loopback PostgreSQL with the
hermetic SMTP fake (no real mail). Skipped unless TEST_DATABASE_URL is set.
"""

from __future__ import annotations

import asyncio

import pytest
import pytest_asyncio

from tests.support.app_client import Tenant, api_client, create_tenant
from tests.support.postgres import bootstrap_supabase_stubs, scratch_database
from tests.support.alembic_runner import upgrade_to_head


@pytest_asyncio.fixture
async def seeded_api(tmp_path):
    async with scratch_database("ia_send_overrides") as url:
        await bootstrap_supabase_stubs(url)
        await upgrade_to_head(url)

        owner = await create_tenant(url, "owner@example.com")
        async with api_client(url, {"owner": owner}, tmp_path / "data") as (request, harness):
            await _seed_exported_invoice(request, owner)
            yield request, owner, harness


async def _seed_exported_invoice(request, tenant: Tenant) -> None:
    assert (
        await request(tenant, "put", "/api/settings", json={"name": "Owner Consulting", "email": tenant.email})
    ).status_code == 200
    response = await request(
        tenant, "post", "/api/clients", json={"name": "Owner Client", "email": "client@example.com"}
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
            "from": {"name": "Owner Consulting", "email": "billing@example.com"},
            "to": {"client_id": tenant.client_id, "name": "Owner Client", "email": "client@example.com"},
            "line_items": [
                {"description": "Work", "quantity": 1, "unit": "item", "unit_price": 10, "subtotal": 10}
            ],
            "totals": {"subtotal": 10, "grand_total": 10},
        },
    )
    assert response.status_code == 200, response.text
    tenant.invoice_record_id = (await request(tenant, "get", "/api/invoices")).json()[0]["id"]


async def test_send_forwards_overrides_to_mailer(seeded_api) -> None:
    request, owner, harness = seeded_api

    response = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json={
            "subject": "Override subject",
            "message": "Override body",
            "recipient_email": "someone-else@example.com",
            "cc_email": "cc-override@example.com",
            "reply_to_email": "reply-override@example.com",
            "from_display_name": "Override Sender",
        },
    )
    assert response.status_code == 200, response.text

    sent = harness["emails"].sent[-1]
    assert sent["recipient_email"] == "someone-else@example.com"
    assert sent["cc_email"] == "cc-override@example.com"
    assert sent["reply_to_email"] == "reply-override@example.com"
    assert sent["from_display_name"] == "Override Sender"

    # The persisted row reflects the effective recipient/cc.
    email = response.json()["email"]
    assert email["recipient_email"] == "someone-else@example.com"
    assert email["cc_email"] == "cc-override@example.com"


async def test_send_without_overrides_uses_server_defaults(seeded_api) -> None:
    request, owner, harness = seeded_api

    response = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json={"subject": "Default subject", "message": "Default body"},
    )
    assert response.status_code == 200, response.text

    sent = harness["emails"].sent[-1]
    assert sent["recipient_email"] == "client@example.com"
    assert sent["cc_email"] == "owner@example.com"
    assert sent["reply_to_email"] == "billing@example.com"
    assert sent["from_display_name"] == "Owner Consulting"


async def test_send_explicitly_blank_cc_and_reply_to_clear_defaults(seeded_api) -> None:
    request, owner, harness = seeded_api

    response = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json={
            "subject": "No copies",
            "message": "Send only to the client",
            "cc_email": "",
            "reply_to_email": "",
        },
    )
    assert response.status_code == 200, response.text
    sent = harness["emails"].sent[-1]
    assert sent["cc_email"] is None
    assert sent["reply_to_email"] is None


async def test_send_explicitly_blank_recipient_is_rejected(seeded_api) -> None:
    request, owner, _ = seeded_api

    response = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json={"subject": "Missing recipient", "message": "Must not fall back", "recipient_email": ""},
    )
    assert response.status_code == 422, response.text
    assert "recipient" in response.text.lower()


async def test_repeated_idempotency_key_returns_same_result_without_resending(
    seeded_api, monkeypatch
) -> None:
    from app.api import invoices as invoices_api

    request, owner, harness = seeded_api
    monkeypatch.setattr(invoices_api.settings, "email_send_limit", 1)
    monkeypatch.setattr(invoices_api.settings, "email_send_window_seconds", 60)
    payload = {
        "subject": "One delivery",
        "message": "Network retries must not duplicate this invoice.",
        "idempotency_key": "mobile-send-12345678",
    }

    first = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json=payload,
    )
    second = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json=payload,
    )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["email"]["id"] == first.json()["email"]["id"]
    assert len(harness["emails"].sent) == 1


async def test_active_pending_attempt_is_not_reconciled_or_resent(
    seeded_api, monkeypatch
) -> None:
    from app.api import invoices as invoices_api

    request, owner, harness = seeded_api
    original_send = invoices_api.email_svc.send_invoice_email

    async def cancelled_send(**_kwargs) -> str:
        raise asyncio.CancelledError

    monkeypatch.setattr(invoices_api.settings, "email_send_lease_seconds", 60)
    monkeypatch.setattr(invoices_api.email_svc, "send_invoice_email", cancelled_send)
    payload = {
        "subject": "Interrupted",
        "message": "Lease remains active.",
        "idempotency_key": "active-lease-12345678",
    }
    with pytest.raises((asyncio.CancelledError, RuntimeError)):
        await request(
            owner,
            "post",
            f"/api/invoices/{owner.invoice_record_id}/send",
            json=payload,
        )
    monkeypatch.setattr(invoices_api.email_svc, "send_invoice_email", original_send)

    pending = await request(
        owner,
        "get",
        f"/api/invoices/{owner.invoice_record_id}/email-attempts/pending",
    )
    assert pending.status_code == 200, pending.text
    attempt_id = pending.json()[0]["id"]
    replay = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json=payload,
    )
    reconcile = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/email-attempts/{attempt_id}/reconcile",
        json={"resolution": "not_delivered"},
    )

    assert replay.status_code == 409, replay.text
    assert int(replay.headers["retry-after"]) >= 1
    assert reconcile.status_code == 409, reconcile.text
    assert harness["emails"].sent == []


async def test_expired_pending_attempt_can_be_reconciled_then_retried(
    seeded_api, monkeypatch
) -> None:
    from app.api import invoices as invoices_api

    request, owner, harness = seeded_api
    original_send = invoices_api.email_svc.send_invoice_email

    async def cancelled_send(**_kwargs) -> str:
        raise asyncio.CancelledError

    monkeypatch.setattr(invoices_api.settings, "email_send_lease_seconds", -1)
    monkeypatch.setattr(invoices_api.email_svc, "send_invoice_email", cancelled_send)
    payload = {
        "subject": "Interrupted",
        "message": "Operator rules out delivery.",
        "idempotency_key": "stale-lease-12345678",  # gitleaks:allow
    }
    with pytest.raises((asyncio.CancelledError, RuntimeError)):
        await request(
            owner,
            "post",
            f"/api/invoices/{owner.invoice_record_id}/send",
            json=payload,
        )
    monkeypatch.setattr(invoices_api.email_svc, "send_invoice_email", original_send)
    monkeypatch.setattr(invoices_api.settings, "email_send_lease_seconds", 60)

    pending = await request(
        owner,
        "get",
        f"/api/invoices/{owner.invoice_record_id}/email-attempts/pending",
    )
    assert pending.status_code == 200, pending.text
    attempt_id = pending.json()[0]["id"]
    ambiguous = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json=payload,
    )
    reconciled = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/email-attempts/{attempt_id}/reconcile",
        json={"resolution": "not_delivered"},
    )
    retried = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json=payload,
    )

    assert ambiguous.status_code == 409, ambiguous.text
    assert "reconcile" in ambiguous.text.lower()
    assert reconciled.status_code == 200, reconciled.text
    assert reconciled.json()["status"] == "failed"
    assert retried.status_code == 200, retried.text
    assert retried.json()["email"]["id"] == attempt_id
    assert len(harness["emails"].sent) == 1


async def test_superseded_worker_cannot_overwrite_reconciliation(
    seeded_api, monkeypatch
) -> None:
    from app.api import invoices as invoices_api

    request, owner, _ = seeded_api
    provider_started = asyncio.Event()
    release_provider = asyncio.Event()

    async def delayed_send(**_kwargs) -> str:
        provider_started.set()
        await release_provider.wait()
        return "<late-provider-result@test>"

    monkeypatch.setattr(invoices_api.settings, "email_send_lease_seconds", -1)
    monkeypatch.setattr(invoices_api.email_svc, "send_invoice_email", delayed_send)
    send_task = asyncio.create_task(
        request(
            owner,
            "post",
            f"/api/invoices/{owner.invoice_record_id}/send",
            json={
                "subject": "Delayed",
                "message": "Do not overwrite reconciliation.",
                "idempotency_key": "superseded-worker-12345678",
            },
        )
    )
    await provider_started.wait()

    pending = await request(
        owner,
        "get",
        f"/api/invoices/{owner.invoice_record_id}/email-attempts/pending",
    )
    email_id = pending.json()[0]["id"]
    reconciled = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/email-attempts/{email_id}/reconcile",
        json={"resolution": "not_delivered"},
    )
    assert reconciled.status_code == 200
    assert reconciled.json()["status"] == "failed"

    release_provider.set()
    response = await send_task
    assert response.status_code == 409
    assert (
        await request(
            owner,
            "get",
            f"/api/invoices/{owner.invoice_record_id}/emails",
        )
    ).json() == []


async def test_idempotency_key_rejects_changed_content(seeded_api) -> None:
    request, owner, harness = seeded_api
    key = "content-lock-12345678"

    first = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json={"subject": "Original", "message": "Original body", "idempotency_key": key},
    )
    changed = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json={"subject": "Changed", "message": "Original body", "idempotency_key": key},
    )

    assert first.status_code == 200, first.text
    assert changed.status_code == 409, changed.text
    assert len(harness["emails"].sent) == 1


async def test_failed_send_retries_same_record_and_message_id(seeded_api, monkeypatch) -> None:
    from app.api import invoices as invoices_api

    request, owner, _ = seeded_api
    calls: list[dict] = []

    async def flaky_send(**kwargs) -> str:
        calls.append(kwargs)
        if len(calls) == 1:
            raise TimeoutError("smtp-password=must-not-leak")
        return kwargs["message_id"]

    monkeypatch.setattr(invoices_api.email_svc, "send_invoice_email", flaky_send)
    payload = {
        "subject": "Retry safely",
        "message": "Use the same provider identity.",
        "idempotency_key": "retry-safe-12345678",
    }

    failed = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json=payload,
    )
    retried = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json=payload,
    )

    assert failed.status_code == 502, failed.text
    assert "must-not-leak" not in failed.text
    assert retried.status_code == 200, retried.text
    assert len(calls) == 2
    assert calls[0]["message_id"] == calls[1]["message_id"]
    assert retried.json()["email"]["provider_message_id"] == calls[0]["message_id"]


async def test_email_rate_limit_blocks_before_smtp(seeded_api, monkeypatch) -> None:
    from app.api import invoices as invoices_api

    request, owner, harness = seeded_api
    monkeypatch.setattr(invoices_api.settings, "email_send_limit", 1)
    monkeypatch.setattr(invoices_api.settings, "email_send_window_seconds", 60)

    first = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json={
            "subject": "First",
            "message": "Allowed",
            "idempotency_key": "rate-limit-first-1234",
        },
    )
    blocked = await request(
        owner,
        "post",
        f"/api/invoices/{owner.invoice_record_id}/send",
        json={
            "subject": "Second",
            "message": "Blocked",
            "idempotency_key": "rate-limit-second-1234",
        },
    )

    assert first.status_code == 200, first.text
    assert blocked.status_code == 429, blocked.text
    assert blocked.headers["retry-after"] == "60"
    assert len(harness["emails"].sent) == 1
