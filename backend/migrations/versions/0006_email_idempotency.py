"""Add durable email idempotency metadata.

Revision ID: 0006_email_idempotency
Revises: 0005_restore_email_defaults
"""

import sqlalchemy as sa
from alembic import op

revision = "0006_email_idempotency"
down_revision = "0005_restore_email_defaults"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "invoice_emails",
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        schema="public",
    )
    op.add_column(
        "invoice_emails",
        sa.Column("request_fingerprint", sa.String(length=64), nullable=True),
        schema="public",
    )
    op.add_column(
        "invoice_emails",
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        schema="public",
    )
    op.add_column(
        "invoice_emails",
        sa.Column("attempt_token", sa.String(length=36), nullable=True),
        schema="public",
    )
    op.add_column(
        "invoice_emails",
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        schema="public",
    )
    op.create_unique_constraint(
        "uq_invoice_emails_user_idempotency",
        "invoice_emails",
        ["user_id", "idempotency_key"],
        schema="public",
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_invoice_emails_user_idempotency",
        "invoice_emails",
        type_="unique",
        schema="public",
    )
    op.drop_column("invoice_emails", "lease_expires_at", schema="public")
    op.drop_column("invoice_emails", "attempt_token", schema="public")
    op.drop_column("invoice_emails", "attempt_count", schema="public")
    op.drop_column("invoice_emails", "request_fingerprint", schema="public")
    op.drop_column("invoice_emails", "idempotency_key", schema="public")
