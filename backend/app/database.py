from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

DATABASE_URL = settings.sqlalchemy_database_url

engine = create_async_engine(DATABASE_URL, echo=False)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session


async def init_db() -> None:
    """Create all tables on startup."""
    # Ensure data directory exists
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.invoices_dir.mkdir(parents=True, exist_ok=True)
    settings.chroma_dir.mkdir(parents=True, exist_ok=True)

    async with engine.begin() as conn:
        # Import models so Base knows about them
        from app.models import db_models  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
        await _apply_runtime_migrations(conn)


async def _apply_runtime_migrations(conn: AsyncEngine | AsyncSession) -> None:
    """Apply lightweight schema changes needed for older databases."""
    dialect = conn.dialect.name

    if dialect == "sqlite":
        await _ensure_sqlite_columns(conn)
    elif dialect == "postgresql":
        await _ensure_postgres_columns(conn)


async def _ensure_sqlite_columns(conn: AsyncEngine | AsyncSession) -> None:
    table_columns = {
        "business_settings": {"user_id": "TEXT", "tax_id": "VARCHAR", "default_currency": "VARCHAR DEFAULT 'USD'",
                              "default_tax_pct": "FLOAT DEFAULT 0.0", "payment_terms": "VARCHAR DEFAULT 'Net 30'",
                              "bank_name": "VARCHAR", "account_name": "VARCHAR", "account_number": "VARCHAR",
                              "routing_number": "VARCHAR", "payment_notes": "TEXT"},
        "clients": {"user_id": "TEXT", "client_code": "VARCHAR(32)"},
        "catalog_items": {"user_id": "TEXT"},
        "invoice_records": {
            "user_id": "TEXT",
            "storage_path": "VARCHAR",
            "client_id": "INTEGER",
            "client_invoice_sequence": "INTEGER",
        },
    }

    for table, columns in table_columns.items():
        result = await conn.execute(text(f"PRAGMA table_info({table})"))
        existing = {row[1] for row in result.fetchall()}
        for name, column_type in columns.items():
            if name not in existing:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {column_type}"))


async def _ensure_postgres_columns(conn: AsyncEngine | AsyncSession) -> None:
    statements = [
        "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS user_id UUID",
        "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS tax_id VARCHAR",
        "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS default_currency VARCHAR DEFAULT 'USD'",
        "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS default_tax_pct FLOAT DEFAULT 0.0",
        "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS payment_terms VARCHAR DEFAULT 'Net 30'",
        "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS bank_name VARCHAR",
        "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS account_name VARCHAR",
        "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS account_number VARCHAR",
        "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS routing_number VARCHAR",
        "ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS payment_notes TEXT",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS user_id UUID",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_code VARCHAR(32)",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS user_id UUID",
        "ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS user_id UUID",
        "ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS storage_path VARCHAR",
        "ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS client_id BIGINT",
        "ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS client_invoice_sequence INTEGER",
    ]
    for statement in statements:
        await conn.execute(text(statement))
