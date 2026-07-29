"""Add security audit events used for durable rate limits.

Revision ID: 0007_security_events
Revises: 0006_email_idempotency
"""

import sqlalchemy as sa
from alembic import op

revision = "0007_security_events"
down_revision = "0006_email_idempotency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "security_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("request_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("outcome IN ('allowed', 'blocked')", name="ck_security_events_outcome"),
        sa.ForeignKeyConstraint(["user_id"], ["auth.users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="public",
    )
    op.create_index(
        "ix_security_events_rate_window",
        "security_events",
        ["user_id", "event_type", "created_at"],
        schema="public",
    )
    op.execute("ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.security_events FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY security_events_owner ON public.security_events "
        "FOR SELECT TO authenticated USING (user_id = auth.uid())"
    )
    op.execute("GRANT SELECT ON public.security_events TO authenticated")
    op.execute("GRANT USAGE, SELECT ON SEQUENCE public.security_events_id_seq TO authenticated")


def downgrade() -> None:
    op.drop_index("ix_security_events_rate_window", table_name="security_events", schema="public")
    op.drop_table("security_events", schema="public")
