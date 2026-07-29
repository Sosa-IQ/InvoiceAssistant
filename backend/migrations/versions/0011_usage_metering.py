"""Add AI/voice usage ledger and rolling pack credit balances.

Revision ID: 0011_usage_metering
Revises: 0010_billing
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0011_usage_metering"
down_revision = "0010_billing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "usage_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("feature", sa.String(32), nullable=False),
        sa.Column("tokens_in", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("tokens_out", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("audio_seconds", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("estimated_cost_micros", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("request_id", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "feature IN ('ai_text', 'voice')",
            name="ck_usage_events_feature",
        ),
        sa.CheckConstraint("tokens_in >= 0", name="ck_usage_events_tokens_in"),
        sa.CheckConstraint("tokens_out >= 0", name="ck_usage_events_tokens_out"),
        sa.CheckConstraint("audio_seconds >= 0", name="ck_usage_events_audio_seconds"),
        sa.CheckConstraint(
            "estimated_cost_micros >= 0",
            name="ck_usage_events_estimated_cost_micros",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="public",
    )
    op.create_index(
        "ix_usage_events_user_created",
        "usage_events",
        ["user_id", "created_at"],
        schema="public",
    )
    op.create_index(
        "ix_usage_events_feature_created",
        "usage_events",
        ["feature", "created_at"],
        schema="public",
    )

    op.create_table(
        "usage_pack_credits",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("pack_kind", sa.String(32), nullable=False),
        sa.Column("tokens_remaining", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("voice_seconds_remaining", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("stripe_checkout_session_id", sa.String(255), nullable=False),
        sa.Column("stripe_payment_intent_id", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "pack_kind IN ('ai_tokens', 'voice_seconds')",
            name="ck_usage_pack_credits_kind",
        ),
        sa.CheckConstraint("tokens_remaining >= 0", name="ck_usage_pack_tokens_remaining"),
        sa.CheckConstraint(
            "voice_seconds_remaining >= 0",
            name="ck_usage_pack_voice_seconds_remaining",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "stripe_checkout_session_id",
            name="uq_usage_pack_credits_checkout_session",
        ),
        schema="public",
    )
    op.create_index(
        "ix_usage_pack_credits_user_kind",
        "usage_pack_credits",
        ["user_id", "pack_kind"],
        schema="public",
    )

    for table in ("usage_events", "usage_pack_credits"):
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY {table}_owner_select ON public.{table} "
            "FOR SELECT TO authenticated USING (user_id = auth.uid())"
        )
        op.execute(f"GRANT SELECT ON public.{table} TO authenticated")
        op.execute(f"GRANT USAGE, SELECT ON SEQUENCE public.{table}_id_seq TO authenticated")


def downgrade() -> None:
    for table in ("usage_pack_credits", "usage_events"):
        op.execute(f"DROP POLICY IF EXISTS {table}_owner_select ON public.{table}")
        op.drop_table(table, schema="public")
