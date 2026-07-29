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


def test_core_schema_grants_authenticated_role_table_and_sequence_access() -> None:
    schema = _normalized_schema()

    assert "grant select, insert, update, delete on table public.profiles" in schema
    assert "public.invoice_emails to authenticated" in schema
    assert "grant usage, select on all sequences in schema public to authenticated" in schema


def test_core_schema_declares_billing_lifecycle_columns() -> None:
    schema = _normalized_schema()

    start = schema.index("create table if not exists public.subscriptions")
    end = schema.index("create table if not exists public.stripe_webhook_events", start)
    table = schema[start:end]

    # Durable superseded-subscription history so a rebound row can never rebind
    # again to an id it has already retired.
    assert "superseded_subscription_ids text[] not null default '{}'::text[]" in table
    # Persisted open Checkout session so a delayed webhook / rotated key cannot
    # mint a second session while Stripe still has one open.
    assert "checkout_session_id varchar(255)" in table
    assert "checkout_session_expires_at timestamptz" in table


def test_core_schema_uses_pgvector_embeddings() -> None:
    schema = _normalized_schema()

    assert "create extension if not exists vector with schema extensions" in schema
    assert "create table if not exists public.invoice_embeddings" in schema
    assert "embedding extensions.vector(1536) not null" in schema
    assert "rag_doc_id text" in schema
    assert "chroma_doc_id text" not in schema
