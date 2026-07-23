import base64
import json

import pytest
from fastapi.security import HTTPAuthorizationCredentials

from app import auth


@pytest.mark.asyncio
async def test_asymmetric_supabase_token_uses_remote_validation(monkeypatch) -> None:
    monkeypatch.setattr(auth.settings, "supabase_jwt_secret", "legacy-hs256-secret")
    expected = auth.AuthenticatedUser(id="user-123", email="owner@example.com")
    calls: list[str] = []

    async def fake_remote_validation(token: str) -> auth.AuthenticatedUser:
        calls.append(token)
        return expected

    monkeypatch.setattr(auth, "_get_user_from_supabase", fake_remote_validation)
    header = base64.urlsafe_b64encode(json.dumps({"alg": "ES256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(b"{}").rstrip(b"=").decode()
    signature = base64.urlsafe_b64encode(b"signature").rstrip(b"=").decode()
    token = f"{header}.{payload}.{signature}"

    result = await auth.get_current_user(
        HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    )

    assert result == expected
    assert calls == [token]
