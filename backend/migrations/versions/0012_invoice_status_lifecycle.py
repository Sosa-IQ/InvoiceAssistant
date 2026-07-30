"""Map invoice lifecycle statuses to drafted/sent/paid.

Revision ID: 0012_invoice_status_lifecycle
Revises: 0011_usage_metering
"""

from alembic import op

revision = "0012_invoice_status_lifecycle"
down_revision = "0011_usage_metering"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # User-facing lifecycle for generated invoices.
    # Keep upload pipeline statuses (processing, parse_failed, stored) intact.
    op.execute(
        """
        UPDATE public.invoice_records
        SET status = 'drafted'
        WHERE status IN ('draft', 'exported', 'indexed')
        """
    )


def downgrade() -> None:
    # Best-effort reverse: drafted returns to exported (previous save path).
    op.execute(
        """
        UPDATE public.invoice_records
        SET status = 'exported'
        WHERE status = 'drafted'
        """
    )
    op.execute(
        """
        UPDATE public.invoice_records
        SET status = 'exported'
        WHERE status IN ('sent', 'paid') AND source = 'generated'
        """
    )
