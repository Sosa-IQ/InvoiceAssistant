import base64
import json

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app import auth


def _bearer(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _unsigned_token(algorithm: str) -> str:
    header = base64.urlsafe_b64encode(
        json.dumps({"alg": algorithm, "typ": "JWT"}).encode()
    ).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(b"{}").rstrip(b"=").decode()
    signature = base64.urlsafe_b64encode(b"signature").rstrip(b"=").decode()
    return f"{header}.{payload}.{signature}"


@pytest.mark.asyncio
@pytest.mark.parametrize("algorithm", ["ES256", "RS256"])
async def test_asymmetric_supabase_token_uses_remote_validation(
    monkeypatch, algorithm: str
) -> None:
    monkeypatch.setattr(
        auth.settings, "supabase_jwt_secret", "legacy-hs256-secret-at-least-32-bytes"
    )
    expected = auth.AuthenticatedUser(id="user-123", email="owner@example.com")
    calls: list[str] = []

    async def fake_remote_validation(token: str) -> auth.AuthenticatedUser:
        calls.append(token)
        return expected

    monkeypatch.setattr(auth, "_get_user_from_supabase", fake_remote_validation)
    token = _unsigned_token(algorithm)

    result = await auth.get_current_user(_bearer(token))

    assert result == expected
    assert calls == [token]


@pytest.mark.asyncio
async def test_hs256_token_is_verified_locally(monkeypatch) -> None:
    secret = "legacy-hs256-secret-at-least-32-bytes"
    monkeypatch.setattr(auth.settings, "supabase_jwt_secret", secret)
    token = auth.jwt.encode(
        {"sub": "user-123", "email": "owner@example.com", "aud": "authenticated"},
        secret,
        algorithm="HS256",
    )

    result = await auth.get_current_user(_bearer(token))

    assert result == auth.AuthenticatedUser(id="user-123", email="owner@example.com")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "token",
    [
        "not-a-jwt",
        auth.jwt.encode(
            {"sub": "user-123", "aud": "authenticated"},
            "wrong-secret-but-at-least-32-bytes-long",
            algorithm="HS256",
        ),
    ],
)
async def test_invalid_hs256_tokens_are_rejected(monkeypatch, token: str) -> None:
    monkeypatch.setattr(
        auth.settings, "supabase_jwt_secret", "expected-secret-at-least-32-bytes-long"
    )

    with pytest.raises(HTTPException) as raised:
        await auth.get_current_user(_bearer(token))

    assert raised.value.status_code == 401


@pytest.mark.asyncio
async def test_missing_remote_auth_configuration_fails_closed(monkeypatch) -> None:
    monkeypatch.setattr(auth.settings, "supabase_jwt_secret", "")
    monkeypatch.setattr(auth.settings, "supabase_url", "")
    monkeypatch.setattr(auth.settings, "supabase_anon_key", "")

    with pytest.raises(HTTPException) as raised:
        await auth.get_current_user(_bearer(_unsigned_token("ES256")))

    assert raised.value.status_code == 503
