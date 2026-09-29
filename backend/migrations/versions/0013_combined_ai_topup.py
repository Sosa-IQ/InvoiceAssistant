"""Allow the combined AI top-up pack kind.

Revision ID: 0013_combined_ai_topup
Revises: 0012_invoice_status_lifecycle
"""

from alembic import op

revision = "0013_combined_ai_topup"
down_revision = "0012_invoice_status_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # One 'ai_topup' purchase credits both tokens and voice seconds. The retired
    # single-resource kinds stay valid for existing rows; the app ignores them.
    op.drop_constraint("ck_usage_pack_credits_kind", "usage_pack_credits", type_="check", schema="public")
    op.create_check_constraint(
        "ck_usage_pack_credits_kind",
        "usage_pack_credits",
        "pack_kind IN ('ai_topup', 'ai_tokens', 'voice_seconds')",
        schema="public",
    )


def downgrade() -> None:
    # Best-effort reverse: combined packs are relabeled as AI packs. Their voice
    # balance is kept in the row but the previous code will not spend it.
    op.execute("UPDATE public.usage_pack_credits SET pack_kind = 'ai_tokens' WHERE pack_kind = 'ai_topup'")
    op.drop_constraint("ck_usage_pack_credits_kind", "usage_pack_credits", type_="check", schema="public")
    op.create_check_constraint(
        "ck_usage_pack_credits_kind",
        "usage_pack_credits",
        "pack_kind IN ('ai_tokens', 'voice_seconds')",
        schema="public",
    )
