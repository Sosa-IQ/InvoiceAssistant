from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

DATABASE_URL = settings.sqlalchemy_database_url

engine = create_async_engine(DATABASE_URL, echo=False)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)

# Keep in step with the newest file in backend/migrations/versions.
EXPECTED_SCHEMA_REVISION = "0005_restore_email_defaults"


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session


async def init_db() -> None:
    """Prepare local directories and refuse to serve an out-of-date schema."""
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.invoices_dir.mkdir(parents=True, exist_ok=True)

    if not DATABASE_URL.startswith("postgresql+asyncpg://"):
        raise RuntimeError("DATABASE_URL must use the postgresql+asyncpg driver.")

    await verify_schema_is_current()


async def verify_schema_is_current(database_url: str | None = None) -> None:
    """Assert the database is migrated to the revision this code expects.

    The schema is owned by the versioned migrations in ``backend/migrations``,
    not by application startup. Booting against an unmigrated database is a
    deployment error, so it fails loudly here instead of being silently
    patched up at runtime.
    """
    target_engine = (
        engine if database_url is None else create_async_engine(database_url, echo=False)
    )

    try:
        async with target_engine.connect() as conn:
            if conn.dialect.name != "postgresql":
                raise RuntimeError("Invoice Assistant backend supports PostgreSQL only.")

            version_table = await conn.scalar(
                text("SELECT to_regclass('public.alembic_version')")
            )
            if version_table is None:
                raise _pending_migrations_error(None)

            result = await conn.execute(text("SELECT version_num FROM alembic_version"))
            revisions = {row[0] for row in result}
    finally:
        if database_url is not None:
            await target_engine.dispose()

    if revisions != {EXPECTED_SCHEMA_REVISION}:
        raise _pending_migrations_error(revisions)


def _pending_migrations_error(revisions: set[str] | None) -> RuntimeError:
    current = ", ".join(sorted(revisions)) if revisions else "none"
    return RuntimeError(
        "Database schema is not up to date "
        f"(expected revision {EXPECTED_SCHEMA_REVISION}, found: {current}). "
        "Run `alembic upgrade head` from the backend directory before starting "
        "the API. See docs/migrations.md."
    )
