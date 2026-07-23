"""Per-client invoice numbering.

Adds the stable per-client code and the per-client sequence that back the
``INV-{CLIENTCODE}_{sequence}`` display format, with uniqueness scoped to the
owning user. Mirrors ``supabase/add_per_client_invoice_numbering.sql``.

Revision ID: 0002_client_numbering
Revises: 0001_baseline
"""

from alembic import op

revision = "0002_client_numbering"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

UPGRADE = (
    "alter table public.clients add column if not exists client_code text",
    """
    alter table public.invoice_records
      add column if not exists client_id bigint references public.clients(id) on delete set null
    """,
    "alter table public.invoice_records add column if not exists client_invoice_sequence integer",
    "alter table public.clients drop constraint if exists uq_clients_user_id_client_code",
    """
    alter table public.clients
      add constraint uq_clients_user_id_client_code unique (user_id, client_code)
    """,
    """
    alter table public.invoice_records
      drop constraint if exists uq_invoice_records_user_client_sequence
    """,
    """
    alter table public.invoice_records
      add constraint uq_invoice_records_user_client_sequence
      unique (user_id, client_id, client_invoice_sequence)
    """,
    "create index if not exists ix_clients_client_code on public.clients(client_code)",
    "create index if not exists ix_invoice_records_client_id on public.invoice_records(client_id)",
)

DOWNGRADE = (
    "drop index if exists public.ix_invoice_records_client_id",
    "drop index if exists public.ix_clients_client_code",
    """
    alter table public.invoice_records
      drop constraint if exists uq_invoice_records_user_client_sequence
    """,
    "alter table public.clients drop constraint if exists uq_clients_user_id_client_code",
    "alter table public.invoice_records drop column if exists client_invoice_sequence",
    "alter table public.invoice_records drop column if exists client_id",
    "alter table public.clients drop column if exists client_code",
)


def upgrade() -> None:
    for statement in UPGRADE:
        op.execute(statement)


def downgrade() -> None:
    for statement in DOWNGRADE:
        op.execute(statement)
