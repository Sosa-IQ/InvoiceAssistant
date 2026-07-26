"""Restore server defaults omitted by the former SQLAlchemy startup schema.

Revision ID: 0005_restore_email_defaults
Revises: 0004_normalize_adopted_schema
"""

from alembic import op

revision = "0005_restore_email_defaults"
down_revision = "0004_normalize_adopted_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table public.invoice_emails
          alter column status set default 'pending',
          alter column provider set default 'smtp',
          alter column created_at set default now()
        """
    )


def downgrade() -> None:
    # The defaults are part of every clean pre-0005 schema. Removing them would
    # recreate adoption drift rather than restore a valid prior application state.
    pass
