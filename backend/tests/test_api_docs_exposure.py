"""API docs must not be served in production."""

import importlib
import sys

import httpx


async def _status(path: str) -> int:
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
        return (await client.get(path)).status_code


async def test_docs_hidden_in_production(monkeypatch) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "app_environment", "production")
    monkeypatch.delitem(sys.modules, "app.main", raising=False)
    try:
        importlib.import_module("app.main")
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert await _status(path) == 404, path
    finally:
        # Reload with the original environment so other tests get the normal app.
        monkeypatch.undo()
        sys.modules.pop("app.main", None)
        importlib.import_module("app.main")


async def test_docs_available_in_development() -> None:
    assert await _status("/openapi.json") == 200
