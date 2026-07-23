"""Safety regressions for the database-backed API harness itself."""

from __future__ import annotations

import pytest

from tests.support import app_client as harness_module


async def test_external_service_key_is_restored_when_http_setup_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    """A failed AsyncClient enter must not leave live credentials disabled."""
    from app.config import settings

    sentinel = "sentinel-service-role-key"
    monkeypatch.setattr(settings, "supabase_service_role_key", sentinel)

    class FailingAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            raise RuntimeError("intentional HTTP harness setup failure")

        async def __aexit__(self, exc_type, exc, traceback) -> None:
            return None

    monkeypatch.setattr(harness_module.httpx, "AsyncClient", FailingAsyncClient)

    with pytest.raises(RuntimeError, match="intentional HTTP harness setup failure"):
        async with harness_module.api_client(
            "postgresql+asyncpg://postgres@localhost:55432/unused",
            {},
            tmp_path,
        ):
            pass

    assert settings.supabase_service_role_key == sentinel
