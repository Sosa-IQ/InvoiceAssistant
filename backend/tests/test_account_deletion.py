"""Orchestration of DELETE /api/auth/account without a database.

The cascade itself is covered against real PostgreSQL in test_tenant_isolation.py;
these tests pin the ordering and fail-closed behavior around external services.
"""

from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest
import stripe

from app import auth
from app.api import auth as auth_api
from app.config import settings
from app.database import get_db
from app.main import app

USER = auth.AuthenticatedUser(id="11111111-1111-1111-1111-111111111111", email="owner@example.com")


class _Result:
    def __init__(self, value) -> None:
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return SimpleNamespace(all=lambda: self._value)


class FakeSession:
    """Returns queued results for the endpoint's three reads: profile, subscription, file paths."""

    def __init__(self, *results) -> None:
        self._results = list(results)

    async def execute(self, _statement):
        return _Result(self._results.pop(0))

    async def rollback(self) -> None:
        return None


@pytest.fixture
def calls(monkeypatch):
    log: list[tuple] = []
    monkeypatch.setattr(settings, "supabase_url", "https://project.test")
    monkeypatch.setattr(settings, "supabase_service_role_key", "service-role-for-test")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_for_tests")

    async def list_subs(customer_id):
        log.append(("list_subs", customer_id))
        return [{"id": "sub_active", "status": "active"}, {"id": "sub_old", "status": "canceled"}]

    async def cancel(subscription_id):
        log.append(("cancel", subscription_id))

    async def list_paths(prefix):
        log.append(("list_paths", prefix))
        return [f"{prefix}/doc/a.pdf"]

    async def delete_objects(paths):
        log.append(("delete_objects", tuple(paths)))

    async def delete_auth_user(user_id):
        log.append(("delete_auth_user", user_id))

    monkeypatch.setattr(auth_api.stripe_service, "list_subscriptions_for_customer", list_subs)
    monkeypatch.setattr(auth_api.stripe_service, "cancel_subscription", cancel)
    monkeypatch.setattr(auth_api.supabase_svc, "list_object_paths", list_paths)
    monkeypatch.setattr(auth_api.supabase_svc, "delete_objects", delete_objects)
    monkeypatch.setattr(auth_api.supabase_svc, "delete_auth_user", delete_auth_user)
    return log


async def _delete(session: FakeSession, confirm_email: str = "owner@example.com") -> httpx.Response:
    async def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[auth.get_current_user] = lambda: USER
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.request("DELETE", "/api/auth/account", json={"confirm_email": confirm_email})
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(auth.get_current_user, None)


def _session(customer_id: str | None = "cus_123") -> FakeSession:
    profile = SimpleNamespace(email="owner@example.com")
    subscription = SimpleNamespace(stripe_customer_id=customer_id) if customer_id else None
    return FakeSession(profile, subscription, [])


async def test_deletes_in_order_and_cancels_only_live_subscriptions(calls) -> None:
    response = await _delete(_session(), confirm_email="  Owner@Example.com ")

    assert response.status_code == 204, response.text
    assert calls == [
        ("list_subs", "cus_123"),
        ("cancel", "sub_active"),
        ("list_paths", USER.id),
        ("delete_objects", (f"{USER.id}/doc/a.pdf",)),
        ("delete_auth_user", USER.id),
    ]


async def test_email_mismatch_deletes_nothing(calls) -> None:
    response = await _delete(_session(), confirm_email="someone-else@example.com")

    assert response.status_code == 400
    assert calls == []


async def test_stripe_failure_aborts_before_any_deletion(calls, monkeypatch) -> None:
    async def failing_list(_customer_id):
        raise stripe.APIConnectionError("network down")

    monkeypatch.setattr(auth_api.stripe_service, "list_subscriptions_for_customer", failing_list)

    response = await _delete(_session())

    assert response.status_code == 502
    assert "nothing was deleted" in response.json()["detail"]
    assert calls == []


async def test_storage_failure_keeps_the_auth_user(calls, monkeypatch) -> None:
    async def failing_delete(_paths):
        raise httpx.HTTPError("storage down")

    monkeypatch.setattr(auth_api.supabase_svc, "delete_objects", failing_delete)

    response = await _delete(_session(customer_id=None))

    assert response.status_code == 502
    assert ("delete_auth_user", USER.id) not in calls


async def test_unconfigured_supabase_fails_closed(calls, monkeypatch) -> None:
    monkeypatch.setattr(settings, "supabase_service_role_key", "")

    response = await _delete(_session())

    assert response.status_code == 503
    assert calls == []


async def test_list_object_paths_walks_nested_folders(monkeypatch) -> None:
    from app.services import supabase_service as module

    monkeypatch.setattr(settings, "supabase_service_role_key", "service-role-for-test")
    tree = {
        "u1": [{"name": "doc-a", "id": None}, {"name": "doc-b", "id": None}],
        "u1/doc-a": [{"name": "a.pdf", "id": "1"}],
        "u1/doc-b": [{"name": "b.pdf", "id": "2"}, {"name": "c.pdf", "id": "3"}],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        assert request.url.path == "/storage/v1/object/list/invoices"
        return httpx.Response(200, json=tree.get(json.loads(request.content)["prefix"], []))

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        module.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw)
    )
    service = module.SupabaseService()
    service.base_url = "https://project.test"
    service.bucket = "invoices"

    assert sorted(await service.list_object_paths("u1")) == ["u1/doc-a/a.pdf", "u1/doc-b/b.pdf", "u1/doc-b/c.pdf"]
