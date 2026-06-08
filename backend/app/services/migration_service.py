import json
import logging
import sqlite3
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.db_models import BusinessSettings, CatalogItem, Client, ClientAddress, InvoiceRecord, Profile
from app.services.supabase_service import SupabaseService

logger = logging.getLogger(__name__)


class MigrationService:
    def __init__(self, supabase: SupabaseService) -> None:
        self.supabase = supabase

    async def migrate_if_enabled(self, db: AsyncSession) -> None:
        if not settings.migrate_local_data:
            return
        if not settings.legacy_sqlite_path.exists():
            logger.info("Legacy sqlite DB not found; skipping migration.")
            return

        result = await db.execute(select(Profile).where(Profile.email == settings.bootstrap_user_email))
        profile = result.scalar_one_or_none()
        if profile is None:
            bootstrap_user = await self.supabase.ensure_bootstrap_user()
            profile = Profile(
                id=bootstrap_user["id"],
                email=bootstrap_user["email"],
                display_name=bootstrap_user.get("user_metadata", {}).get("display_name"),
            )
            db.add(profile)
            await db.commit()
            await db.refresh(profile)

        existing = await db.execute(select(Client.id).where(Client.user_id == profile.id).limit(1))
        if existing.scalar_one_or_none() is not None:
            logger.info("Supabase-backed data already present; skipping legacy migration.")
            return

        await self._migrate_legacy_sqlite(db, profile.id)

    async def _migrate_legacy_sqlite(self, db: AsyncSession, user_id: str) -> None:
        logger.info("Migrating legacy sqlite data into the configured database.")
        conn = sqlite3.connect(settings.legacy_sqlite_path)
        conn.row_factory = sqlite3.Row

        client_map: dict[int, int] = {}
        try:
            settings_row = conn.execute("SELECT * FROM business_settings LIMIT 1").fetchone()
            if settings_row is not None:
                db.add(BusinessSettings(user_id=user_id, **dict(settings_row)))
                await db.commit()

            for row in conn.execute("SELECT * FROM clients ORDER BY id").fetchall():
                payload = dict(row)
                legacy_id = payload.pop("id")
                payload.pop("user_id", None)
                client = Client(user_id=user_id, **payload)
                db.add(client)
                await db.flush()
                client_map[legacy_id] = client.id

            for row in conn.execute("SELECT * FROM client_addresses ORDER BY id").fetchall():
                payload = dict(row)
                payload.pop("id", None)
                payload["client_id"] = client_map[payload["client_id"]]
                db.add(ClientAddress(**payload))

            for row in conn.execute("SELECT * FROM catalog_items ORDER BY id").fetchall():
                payload = dict(row)
                payload.pop("id", None)
                payload.pop("user_id", None)
                db.add(CatalogItem(user_id=user_id, **payload))

            for row in conn.execute("SELECT * FROM invoice_records ORDER BY id").fetchall():
                payload = dict(row)
                payload.pop("id", None)
                payload.pop("user_id", None)
                file_path = Path(payload["file_path"])
                storage_path = None
                if file_path.exists():
                    storage_path = await self.supabase.migrate_local_file(user_id, "legacy", file_path)
                payload["storage_path"] = storage_path
                db.add(InvoiceRecord(user_id=user_id, **payload))

            await db.commit()
        finally:
            conn.close()
