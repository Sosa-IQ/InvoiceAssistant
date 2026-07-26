import io
import json
import logging

import httpx
import pytest

from app.main import app
from app.observability import JsonFormatter, _scrub_sentry_event


@pytest.mark.anyio
async def test_liveness_returns_request_id() -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "live"}
    assert response.headers["x-request-id"]


@pytest.mark.anyio
async def test_safe_caller_request_id_is_propagated() -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get(
            "/health/live", headers={"X-Request-ID": "mobile-check-123"}
        )

    assert response.headers["x-request-id"] == "mobile-check-123"


@pytest.mark.anyio
async def test_unsafe_caller_request_id_is_replaced() -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get(
            "/health/live", headers={"X-Request-ID": "bad id with spaces"}
        )

    assert response.status_code == 200
    assert response.headers["x-request-id"] != "bad id with spaces"


@pytest.mark.anyio
async def test_readiness_returns_503_when_database_check_fails(monkeypatch) -> None:
    async def unavailable() -> bool:
        return False

    monkeypatch.setattr("app.main.database_is_ready", unavailable)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}


def test_json_formatter_emits_only_allowlisted_metadata() -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("test.observability")
    logger.handlers = [handler]
    logger.propagate = False
    logger.setLevel(logging.INFO)

    logger.info(
        "request_complete",
        extra={
            "request_id": "req-1",
            "method": "POST",
            "path": "/api/invoices/1/send",
            "status_code": 200,
            "duration_ms": 12.5,
            "authorization": "Bearer secret",
            "request_body": "private invoice contents",
        },
    )

    payload = json.loads(stream.getvalue())
    assert payload["event"] == "request_complete"
    assert payload["request_id"] == "req-1"
    assert payload["path"] == "/api/invoices/1/send"
    serialized = json.dumps(payload)
    assert "Bearer secret" not in serialized
    assert "private invoice contents" not in serialized


def test_sentry_scrubber_removes_nested_stack_frame_locals() -> None:
    event = {
        "exception": {
            "values": [{"stacktrace": {"frames": [{"vars": {"recipient": "private@example.com"}}]}}]
        },
        "threads": {
            "values": [{"stacktrace": {"frames": [{"vars": {"smtp_password": "secret"}}]}}]
        },
    }

    scrubbed = _scrub_sentry_event(event, {})

    serialized = json.dumps(scrubbed)
    assert "private@example.com" not in serialized
    assert "secret" not in serialized
    assert "vars" not in serialized
