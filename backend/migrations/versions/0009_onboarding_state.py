"""Track tenant onboarding completion state.

Adds a nullable, timezone-aware ``onboarding_completed_at`` to
``business_settings``. Null means onboarding is incomplete; the API stamps the
timestamp server-side when a tenant finishes onboarding and clears it on reset.

Revision ID: 0009_onboarding_state
Revises: 0008_email_templates
"""

import sqlalchemy as sa
from alembic import op

revision = "0009_onboarding_state"
down_revision = "0008_email_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "business_settings",
        sa.Column(
            "onboarding_completed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        schema="public",
    )
    # Existing tenants predate onboarding even when they never opened Settings
    # (settings rows are created lazily). Materialize a completed row for every
    # pre-existing profile first, then backfill any settings rows that did exist.
    op.execute(
        "insert into public.business_settings (user_id, onboarding_completed_at) "
        "select profiles.id, now() from public.profiles "
        "left join public.business_settings "
        "on business_settings.user_id = profiles.id "
        "where business_settings.user_id is null"
    )
    op.execute(
        "update public.business_settings "
        "set onboarding_completed_at = now() "
        "where onboarding_completed_at is null"
    )


def downgrade() -> None:
    op.drop_column("business_settings", "onboarding_completed_at", schema="public")
