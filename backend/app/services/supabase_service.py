import logging
from pathlib import Path
from urllib.parse import quote

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class SupabaseService:
    def __init__(self) -> None:
        self.base_url = settings.supabase_url.rstrip("/")
        self.bucket = settings.supabase_storage_bucket

    def _headers(self) -> dict[str, str]:
        if not settings.supabase_service_role_key:
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not configured.")
        return {
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
        }

    async def ensure_bucket(self) -> None:
        if not self.base_url or not settings.supabase_service_role_key:
            return

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.base_url}/storage/v1/bucket",
                headers=self._headers(),
            )
            response.raise_for_status()
            buckets = response.json()
            if any(bucket["name"] == self.bucket for bucket in buckets):
                return

            create = await client.post(
                f"{self.base_url}/storage/v1/bucket",
                headers={**self._headers(), "Content-Type": "application/json"},
                json={"name": self.bucket, "public": False},
            )
            create.raise_for_status()

    async def upload_bytes(self, storage_path: str, payload: bytes, content_type: str) -> str:
        if not self.base_url:
            raise RuntimeError("SUPABASE_URL is not configured.")

        url = f"{self.base_url}/storage/v1/object/{self.bucket}/{quote(storage_path)}"
        headers = {**self._headers(), "Content-Type": content_type, "x-upsert": "true"}
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(url, headers=headers, content=payload)
            response.raise_for_status()
        return storage_path

    async def download_bytes(self, storage_path: str) -> bytes:
        url = f"{self.base_url}/storage/v1/object/{self.bucket}/{quote(storage_path)}"
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.get(url, headers=self._headers())
            response.raise_for_status()
            return response.content

    async def migrate_local_file(self, user_id: str, folder: str, file_path: Path) -> str:
        storage_path = f"{user_id}/{folder}/{file_path.name}"
        await self.upload_bytes(storage_path, file_path.read_bytes(), "application/pdf")
        return storage_path

    async def ensure_bootstrap_user(self) -> dict:
        if not self.base_url:
            raise RuntimeError("SUPABASE_URL is not configured.")

        payload = {
            "email": settings.bootstrap_user_email,
            "password": settings.bootstrap_user_password,
            "email_confirm": True,
            "user_metadata": {"display_name": "Bootstrap Owner"},
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.base_url}/auth/v1/admin/users",
                headers={**self._headers(), "Content-Type": "application/json"},
                json=payload,
            )
            if response.status_code == 422:
                existing = await client.get(
                    f"{self.base_url}/auth/v1/admin/users",
                    headers=self._headers(),
                )
                existing.raise_for_status()
                for user in existing.json().get("users", []):
                    if user.get("email") == settings.bootstrap_user_email:
                        return user
            response.raise_for_status()
            return response.json().get("user", response.json())
