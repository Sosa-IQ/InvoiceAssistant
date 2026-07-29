"""Validation and defaults for tenant-customizable email templates.

The fast tests below exercise the Pydantic schema directly (no database). The
API-level tests at the bottom run over the real API against a disposable
loopback PostgreSQL and are skipped unless TEST_DATABASE_URL is set.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.schemas import (
    DEFAULT_EMAIL_MESSAGE_TEMPLATE,
    DEFAULT_EMAIL_SUBJECT_TEMPLATE,
    BusinessSettingsRead,
    BusinessSettingsUpdate,
)

# ---------------------------------------------------------------------------
# Defaults must preserve current behaviour
# ---------------------------------------------------------------------------


def test_default_subject_template_matches_current_send_behavior() -> None:
    assert DEFAULT_EMAIL_SUBJECT_TEMPLATE == "Invoice {invoice_number}"


def test_default_message_template_matches_current_send_behavior() -> None:
    assert DEFAULT_EMAIL_MESSAGE_TEMPLATE == (
        "Hello {client_name},\n\n"
        "Please find invoice {invoice_number} attached.\n\n"
        "Best,\n{business_name}"
    )


def test_business_settings_read_defaults_to_the_current_templates() -> None:
    row = BusinessSettingsRead(id=1, user_id="user-1")
    assert row.default_email_subject == DEFAULT_EMAIL_SUBJECT_TEMPLATE
    assert row.default_email_message == DEFAULT_EMAIL_MESSAGE_TEMPLATE


# ---------------------------------------------------------------------------
# Allowed placeholders
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "placeholder",
    ["invoice_number", "client_name", "business_name", "issue_date", "total", "currency"],
)
def test_update_accepts_each_allowed_placeholder(placeholder: str) -> None:
    update = BusinessSettingsUpdate(default_email_subject=f"Re: {{{placeholder}}}")
    assert f"{{{placeholder}}}" in update.default_email_subject


def test_update_accepts_all_allowed_placeholders_in_message() -> None:
    message = (
        "{client_name} {business_name} {invoice_number} {issue_date} {total} {currency}"
    )
    update = BusinessSettingsUpdate(default_email_message=message)
    assert update.default_email_message == message


def test_update_rejects_unknown_placeholder_in_subject() -> None:
    with pytest.raises(ValidationError, match="Unknown placeholder"):
        BusinessSettingsUpdate(default_email_subject="Invoice {secret_field}")


def test_update_rejects_unknown_placeholder_in_message() -> None:
    with pytest.raises(ValidationError, match="Unknown placeholder"):
        BusinessSettingsUpdate(default_email_message="Hello {client_name}, your {account_balance}.")


@pytest.mark.parametrize(
    "template",
    ["Invoice {invoice-number}", "Invoice { invoice_number }", "Invoice {invoice_number"],
)
def test_update_rejects_malformed_placeholder_syntax(template: str) -> None:
    with pytest.raises(ValidationError, match="Malformed placeholder"):
        BusinessSettingsUpdate(default_email_subject=template)


# ---------------------------------------------------------------------------
# Bounds and blank rejection
# ---------------------------------------------------------------------------


def test_update_rejects_blank_subject() -> None:
    with pytest.raises(ValidationError, match="cannot be blank"):
        BusinessSettingsUpdate(default_email_subject="   ")


def test_update_rejects_blank_message() -> None:
    with pytest.raises(ValidationError, match="cannot be blank"):
        BusinessSettingsUpdate(default_email_message="   ")


def test_update_rejects_multiline_subject() -> None:
    with pytest.raises(ValidationError, match="single line"):
        BusinessSettingsUpdate(default_email_subject="Invoice {invoice_number}\nSecond line")


def test_update_rejects_subject_over_200_chars() -> None:
    with pytest.raises(ValidationError):
        BusinessSettingsUpdate(default_email_subject="x" * 201)


def test_update_rejects_message_over_5000_chars() -> None:
    with pytest.raises(ValidationError):
        BusinessSettingsUpdate(default_email_message="x" * 5001)


def test_update_accepts_subject_at_the_200_char_bound() -> None:
    update = BusinessSettingsUpdate(default_email_subject="x" * 200)
    assert len(update.default_email_subject) == 200


def test_update_accepts_message_at_the_5000_char_bound() -> None:
    update = BusinessSettingsUpdate(default_email_message="x" * 5000)
    assert len(update.default_email_message) == 5000


def test_update_leaves_templates_unset_by_default() -> None:
    update = BusinessSettingsUpdate()
    assert "default_email_subject" not in update.model_dump(exclude_unset=True)
    assert "default_email_message" not in update.model_dump(exclude_unset=True)


@pytest.mark.parametrize("field", ["default_email_subject", "default_email_message"])
def test_update_rejects_explicit_null_template(field: str) -> None:
    with pytest.raises(ValidationError):
        BusinessSettingsUpdate(**{field: None})


# ---------------------------------------------------------------------------
# API-level behaviour (requires a real PostgreSQL instance)
# ---------------------------------------------------------------------------

import pytest_asyncio  # noqa: E402

from tests.support.app_client import api_client, create_tenant  # noqa: E402
from tests.support.postgres import bootstrap_supabase_stubs, scratch_database  # noqa: E402
from tests.support.alembic_runner import upgrade_to_head  # noqa: E402


@pytest_asyncio.fixture
async def seeded_api(tmp_path):
    async with scratch_database("ia_email_templates") as url:
        await bootstrap_supabase_stubs(url)
        await upgrade_to_head(url)

        owner = await create_tenant(url, "templates-owner@example.com")
        async with api_client(url, {"owner": owner}, tmp_path / "data") as (request, harness):
            yield request, owner, harness


async def test_db_level_default_fires_for_rows_inserted_outside_the_orm() -> None:
    """The server_default must hold even for a bare SQL insert, not just the ORM path."""
    import asyncpg

    from tests.support.postgres import asyncpg_dsn

    async with scratch_database("ia_email_templates_rawsql") as url:
        await bootstrap_supabase_stubs(url)
        await upgrade_to_head(url)

        conn = await asyncpg.connect(asyncpg_dsn(url))
        try:
            user_id = await conn.fetchval(
                "insert into auth.users(email) values('rawsql@example.com') returning id"
            )
            await conn.execute(
                "insert into public.profiles(id, email) values($1, 'rawsql@example.com')",
                user_id,
            )
            row = await conn.fetchrow(
                "insert into public.business_settings(user_id) values($1) "
                "returning default_email_subject, default_email_message",
                user_id,
            )
        finally:
            await conn.close()

        assert row["default_email_subject"] == DEFAULT_EMAIL_SUBJECT_TEMPLATE
        assert row["default_email_message"] == DEFAULT_EMAIL_MESSAGE_TEMPLATE


async def test_get_settings_returns_default_templates_for_a_new_tenant(seeded_api) -> None:
    request, owner, _ = seeded_api

    response = await request(owner, "get", "/api/settings")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["default_email_subject"] == DEFAULT_EMAIL_SUBJECT_TEMPLATE
    assert body["default_email_message"] == DEFAULT_EMAIL_MESSAGE_TEMPLATE


async def test_put_settings_persists_custom_templates(seeded_api) -> None:
    request, owner, _ = seeded_api

    response = await request(
        owner,
        "put",
        "/api/settings",
        json={
            "default_email_subject": "Your invoice {invoice_number} from {business_name}",
            "default_email_message": "Hi {client_name}, total due: {total} {currency}.",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["default_email_subject"] == "Your invoice {invoice_number} from {business_name}"
    assert response.json()["default_email_message"] == "Hi {client_name}, total due: {total} {currency}."

    refetched = await request(owner, "get", "/api/settings")
    assert refetched.json()["default_email_subject"] == "Your invoice {invoice_number} from {business_name}"
    assert refetched.json()["default_email_message"] == "Hi {client_name}, total due: {total} {currency}."


async def test_put_settings_rejects_unknown_placeholder(seeded_api) -> None:
    request, owner, _ = seeded_api

    response = await request(
        owner,
        "put",
        "/api/settings",
        json={"default_email_subject": "Invoice {secret_field}"},
    )
    assert response.status_code == 422, response.text
    assert "unknown placeholder" in response.text.lower()


async def test_put_settings_rejects_overlong_message(seeded_api) -> None:
    request, owner, _ = seeded_api

    response = await request(
        owner,
        "put",
        "/api/settings",
        json={"default_email_message": "x" * 5001},
    )
    assert response.status_code == 422, response.text


async def test_put_settings_rejects_blank_subject(seeded_api) -> None:
    request, owner, _ = seeded_api

    response = await request(
        owner,
        "put",
        "/api/settings",
        json={"default_email_subject": "   "},
    )
    assert response.status_code == 422, response.text
