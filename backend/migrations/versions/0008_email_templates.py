"""Add tenant-customizable default email subject/message templates.

Revision ID: 0008_email_templates
Revises: 0007_security_events
"""

import sqlalchemy as sa
from alembic import op

revision = "0008_email_templates"
down_revision = "0007_security_events"
branch_labels = None
depends_on = None

DEFAULT_SUBJECT = "Invoice {invoice_number}"
DEFAULT_MESSAGE = (
    "Hello {client_name},\n\n"
    "Please find invoice {invoice_number} attached.\n\n"
    "Best,\n{business_name}"
)


def upgrade() -> None:
    op.add_column(
        "business_settings",
        sa.Column(
            "default_email_subject",
            sa.String(length=200),
            nullable=False,
            server_default=DEFAULT_SUBJECT,
        ),
        schema="public",
    )
    op.add_column(
        "business_settings",
        sa.Column(
            "default_email_message",
            sa.Text(),
            nullable=False,
            server_default=DEFAULT_MESSAGE,
        ),
        schema="public",
    )
    op.create_check_constraint(
        "ck_business_settings_email_subject_not_blank",
        "business_settings",
        "length(btrim(default_email_subject)) > 0",
        schema="public",
    )
    op.create_check_constraint(
        "ck_business_settings_email_message_not_blank",
        "business_settings",
        "length(btrim(default_email_message)) > 0",
        schema="public",
    )
    op.create_check_constraint(
        "ck_business_settings_email_message_length",
        "business_settings",
        "char_length(default_email_message) <= 5000",
        schema="public",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_business_settings_email_message_length",
        "business_settings",
        type_="check",
        schema="public",
    )
    op.drop_constraint(
        "ck_business_settings_email_message_not_blank",
        "business_settings",
        type_="check",
        schema="public",
    )
    op.drop_constraint(
        "ck_business_settings_email_subject_not_blank",
        "business_settings",
        type_="check",
        schema="public",
    )
    op.drop_column("business_settings", "default_email_message", schema="public")
    op.drop_column("business_settings", "default_email_subject", schema="public")
