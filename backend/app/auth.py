import logging
from dataclasses import dataclass

import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings

try:
    import jwt
except ModuleNotFoundError as exc:  # pragma: no cover - import-time environment issue
    raise RuntimeError(
        "PyJWT is not installed. Reinstall backend dependencies with "
        "`pip install -r backend/requirements.txt` inside the backend virtualenv."
    ) from exc

logger = logging.getLogger(__name__)
bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class AuthenticatedUser:
    id: str
    email: str | None = None


def _decode_token_with_secret(token: str) -> dict:
    if not settings.supabase_jwt_secret:
        raise HTTPException(503, "SUPABASE_JWT_SECRET is not configured.")

    try:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            options={"verify_aud": False},
        )
    except jwt.InvalidTokenError as exc:
        logger.warning("JWT verification failed: %s", exc)
        raise HTTPException(401, "Invalid authentication token.") from exc


async def _get_user_from_supabase(token: str) -> AuthenticatedUser:
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(503, "Supabase authentication is not configured.")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Authorization": f"Bearer {token}",
                },
            )
    except httpx.HTTPError as exc:
        logger.warning("Supabase auth validation request failed: %s", exc)
        raise HTTPException(503, "Authentication service is unavailable.") from exc

    if response.status_code in {401, 403}:
        raise HTTPException(401, "Invalid authentication token.")
    response.raise_for_status()

    payload = response.json()
    user_id = payload.get("id")
    if not user_id:
        raise HTTPException(401, "Invalid authentication token.")
    return AuthenticatedUser(id=user_id, email=payload.get("email"))


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthenticatedUser:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Authentication required.")

    if settings.supabase_jwt_secret:
        payload = _decode_token_with_secret(credentials.credentials)
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(401, "Invalid authentication token.")
        return AuthenticatedUser(id=user_id, email=payload.get("email"))

    return await _get_user_from_supabase(credentials.credentials)
