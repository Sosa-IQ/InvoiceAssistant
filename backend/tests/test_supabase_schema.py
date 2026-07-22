from pathlib import Path


SCHEMA_PATH = Path(__file__).parents[2] / "supabase" / "setup_invoice_assistant_core.sql"


def _normalized_schema() -> str:
    return " ".join(SCHEMA_PATH.read_text().lower().split())


def test_core_schema_declares_owned_client_addresses() -> None:
    schema = _normalized_schema()

    start = schema.index("create table if not exists public.client_addresses")
    end = schema.index("create table if not exists public.catalog_items", start)
    table = schema[start:end]

    assert "user_id uuid not null references public.profiles(id) on delete cascade" in table
    assert "create index if not exists ix_client_addresses_user_id" in schema


def test_core_schema_contains_email_history_table_and_rls() -> None:
    schema = _normalized_schema()

    assert "create table if not exists public.invoice_emails" in schema
    assert "alter table public.invoice_emails enable row level security" in schema
    assert "invoice emails owner all" in schema


def test_core_schema_uses_pgvector_embeddings() -> None:
    schema = _normalized_schema()

    assert "create extension if not exists vector with schema extensions" in schema
    assert "create table if not exists public.invoice_embeddings" in schema
    assert "embedding extensions.vector(1536) not null" in schema
    assert "rag_doc_id text" in schema
    assert "chroma_doc_id text" not in schema
