"""API docs must not be served in production."""

import httpx
from fastapi import FastAPI

from app.main import api_docs_urls


async def _status(app: FastAPI, path: str) -> int:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
        return (await client.get(path)).status_code


async def test_docs_hidden_in_production() -> None:
    # A fresh app built with production's settings; the shared app is never reloaded,
    # so other tests keep patching the module they imported.
    app = FastAPI(**api_docs_urls("production"))
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert await _status(app, path) == 404, path
    assert api_docs_urls(" Prod ") == {"docs_url": None, "redoc_url": None, "openapi_url": None}


async def test_docs_available_in_development() -> None:
    from app.main import app

    assert await _status(app, "/openapi.json") == 200
