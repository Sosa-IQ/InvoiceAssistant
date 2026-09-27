import logging
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

    async def list_object_paths(self, prefix: str, *, max_depth: int = 4) -> list[str]:
        """Recursively list every object path under ``prefix`` (a folder, no trailing slash)."""
        paths: list[str] = []
        page_size = 1000
        async with httpx.AsyncClient(timeout=30.0) as client:

            async def walk(folder: str, depth: int) -> None:
                offset = 0
                while True:
                    response = await client.post(
                        f"{self.base_url}/storage/v1/object/list/{self.bucket}",
                        headers={**self._headers(), "Content-Type": "application/json"},
                        json={"prefix": folder, "limit": page_size, "offset": offset},
                    )
                    response.raise_for_status()
                    entries = response.json()
                    for entry in entries:
                        path = f"{folder}/{entry['name']}"
                        # Storage reports folders as entries without an id.
                        if entry.get("id") is None:
                            if depth < max_depth:
                                await walk(path, depth + 1)
                        else:
                            paths.append(path)
                    if len(entries) < page_size:
                        return
                    offset += page_size

            await walk(prefix, 1)
        return paths

    async def delete_objects(self, paths: list[str]) -> None:
        batch_size = 1000
        async with httpx.AsyncClient(timeout=60.0) as client:
            for start in range(0, len(paths), batch_size):
                response = await client.request(
                    "DELETE",
                    f"{self.base_url}/storage/v1/object/{self.bucket}",
                    headers={**self._headers(), "Content-Type": "application/json"},
                    json={"prefixes": paths[start : start + batch_size]},
                )
                response.raise_for_status()

    async def delete_auth_user(self, user_id: str) -> None:
        """Delete the Supabase Auth user; app tables cascade from auth.users."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(
                f"{self.base_url}/auth/v1/admin/users/{quote(user_id)}",
                headers=self._headers(),
            )
        if response.status_code == 404:
            logger.info("auth_user_already_deleted")
            return
        response.raise_for_status()
