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
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.invoices_dir.mkdir(parents=True, exist_ok=True)

    if not DATABASE_URL.startswith("postgresql+asyncpg://"):
        raise RuntimeError("DATABASE_URL must use the postgresql+asyncpg driver.")

    async with engine.begin() as conn:
        from app.models import db_models  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
        await _apply_runtime_migrations(conn)


async def _apply_runtime_migrations(conn: AsyncEngine | AsyncSession) -> None:
    """Apply lightweight schema changes needed for older databases."""
    if conn.dialect.name != "postgresql":
        raise RuntimeError("Invoice Assistant backend supports PostgreSQL only.")

    await _ensure_postgres_columns(conn)


async def _ensure_postgres_columns(conn: AsyncEngine | AsyncSession) -> None:
    await conn.execute(
        text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = 'invoice_records'
                      AND column_name = 'chroma_doc_id'
                ) AND NOT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = 'invoice_records'
                      AND column_name = 'rag_doc_id'
                ) THEN
                    ALTER TABLE invoice_records RENAME COLUMN chroma_doc_id TO rag_doc_id;
                END IF;
            END $$;
            """
        )
    )

    statements = [
        "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions",
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
        "ALTER TABLE client_addresses ADD COLUMN IF NOT EXISTS user_id UUID",
        "ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS user_id UUID",
        "ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS user_id UUID",
        "ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS storage_path VARCHAR",
        "ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS client_id BIGINT",
        "ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS client_invoice_sequence INTEGER",
        "ALTER TABLE invoice_records ADD COLUMN IF NOT EXISTS rag_doc_id VARCHAR",
        """
        UPDATE client_addresses AS ca
        SET user_id = c.user_id
        FROM clients AS c
        WHERE ca.client_id = c.id
          AND ca.user_id IS NULL
          AND c.user_id IS NOT NULL
        """,
        """
        CREATE TABLE IF NOT EXISTS invoice_embeddings (
            id BIGSERIAL PRIMARY KEY,
            doc_id UUID NOT NULL,
            user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            invoice_record_id BIGINT NOT NULL REFERENCES invoice_records(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            embedding extensions.vector(1536) NOT NULL,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_invoice_embeddings_doc_chunk UNIQUE (doc_id, chunk_index)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS invoice_emails (
            id BIGSERIAL PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            invoice_record_id BIGINT NOT NULL REFERENCES invoice_records(id) ON DELETE CASCADE,
            recipient_email VARCHAR NOT NULL,
            cc_email VARCHAR,
            subject VARCHAR NOT NULL,
            message_body TEXT NOT NULL,
            status VARCHAR NOT NULL DEFAULT 'pending',
            provider VARCHAR NOT NULL DEFAULT 'smtp',
            provider_message_id VARCHAR,
            error_message TEXT,
            sent_at TIMESTAMP WITHOUT TIME ZONE,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_invoice_embeddings_user_id ON invoice_embeddings(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_invoice_embeddings_record_id ON invoice_embeddings(invoice_record_id)",
        "CREATE INDEX IF NOT EXISTS idx_client_addresses_user_id ON client_addresses(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_invoice_emails_user_id ON invoice_emails(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_invoice_emails_record_id ON invoice_emails(invoice_record_id)",
        """
        CREATE INDEX IF NOT EXISTS idx_invoice_embeddings_embedding_hnsw
        ON invoice_embeddings
        USING hnsw (embedding vector_cosine_ops)
        """,
    ]
    for statement in statements:
        await conn.execute(text(statement))
