"""Add tenant subscription state and Stripe webhook idempotency.

Revision ID: 0010_billing
Revises: 0009_onboarding_state
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0010_billing"
down_revision = "0009_onboarding_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("plan", sa.String(32), nullable=False, server_default="free"),
        sa.Column("status", sa.String(32), nullable=False, server_default="free"),
        sa.Column("stripe_customer_id", sa.String(255), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(255), nullable=True),
        sa.Column("stripe_price_id", sa.String(255), nullable=True),
        sa.Column(
            "superseded_subscription_ids",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_event_created_at", sa.BigInteger(), nullable=True),
        sa.Column("checkout_idempotency_key", sa.String(64), nullable=True),
        sa.Column("checkout_idempotency_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checkout_session_id", sa.String(255), nullable=True),
        sa.Column("checkout_session_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("plan IN ('free', 'pro')", name="ck_subscriptions_plan"),
        sa.ForeignKeyConstraint(["user_id"], ["public.profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_subscriptions_user_id"),
        sa.UniqueConstraint("stripe_customer_id", name="uq_subscriptions_customer"),
        sa.UniqueConstraint("stripe_subscription_id", name="uq_subscriptions_subscription"),
        schema="public",
    )
    op.create_index("ix_subscriptions_user_id", "subscriptions", ["user_id"], unique=True, schema="public")
    op.create_table(
        "stripe_webhook_events",
        sa.Column("event_id", sa.String(255), nullable=False),
        sa.Column("event_type", sa.String(255), nullable=False),
        sa.Column("event_created_at", sa.BigInteger(), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("event_id"),
        schema="public",
    )
    op.execute("alter table public.subscriptions enable row level security")
    op.execute("alter table public.subscriptions force row level security")
    op.execute("alter table public.stripe_webhook_events enable row level security")
    op.execute("alter table public.stripe_webhook_events force row level security")
    op.execute("grant select on table public.subscriptions to authenticated")
    op.execute(
        "grant usage, select on sequence public.subscriptions_id_seq to authenticated"
    )
    op.execute(
        'create policy "subscriptions owner select" on public.subscriptions '
        "for select to authenticated using (user_id = auth.uid())"
    )


def downgrade() -> None:
    op.execute('drop policy if exists "subscriptions owner select" on public.subscriptions')
    op.drop_table("stripe_webhook_events", schema="public")
    op.drop_index("ix_subscriptions_user_id", table_name="subscriptions", schema="public")
    op.drop_table("subscriptions", schema="public")
