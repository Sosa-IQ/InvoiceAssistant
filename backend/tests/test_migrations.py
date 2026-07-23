"""Alembic migration coverage.

The backend used to build its schema with DDL executed on every startup. That
made the deployed schema a function of whichever process last booted, with no
version, no review, and no way back. These tests pin the replacement:

* a clean database bootstrapped by ``alembic upgrade head`` is structurally
  identical to one created by ``supabase/setup_invoice_assistant_core.sql``;
* a database still in the pre-migration shape upgrades to that same schema;
* ``alembic downgrade base`` fully rolls the schema back;
* application startup no longer mutates the schema at all.
"""

from __future__ import annotations

from pathlib import Path

import asyncpg
import pytest

from tests.support.alembic_runner import run_alembic
from tests.support.legacy_schema import build_legacy_schema
from tests.support.postgres import (
    BACKEND_ROOT,
    REPO_ROOT,
    UnsafeTestDatabaseError,
    asyncpg_dsn,
    assert_safe_test_database,
    bootstrap_from_core_sql,
    bootstrap_supabase_stubs,
    scratch_database,
)
from tests.support.schema import (
    application_tables,
    describe_difference,
    snapshot_schema,
)

ALEMBIC_INI = BACKEND_ROOT / "alembic.ini"
MIGRATIONS_DIR = BACKEND_ROOT / "migrations"

# The last revision whose schema matches what the old runtime DDL produced
# before per-client invoice numbering existed.
LEGACY_STAMP_REVISION = "0001_baseline"


# ---------------------------------------------------------------------------
# Safety rails
# ---------------------------------------------------------------------------

def test_managed_supabase_hosts_are_rejected_as_test_databases() -> None:
    with pytest.raises(UnsafeTestDatabaseError, match="managed Supabase host"):
        assert_safe_test_database(
            "postgresql+asyncpg://postgres:pw@db.abcdefgh.supabase.co:5432/postgres"
        )


def test_the_application_database_is_rejected_as_a_test_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = "postgresql+asyncpg://postgres:pw@localhost:5432/invoice_assistant"
    monkeypatch.setenv("DATABASE_URL", url)

    with pytest.raises(UnsafeTestDatabaseError, match="identical to DATABASE_URL"):
        assert_safe_test_database(url)


def test_a_database_url_configured_only_in_dotenv_is_still_rejected(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The app database is usually configured in backend/.env, not exported."""
    from tests.support import postgres as postgres_support

    monkeypatch.delenv("DATABASE_URL", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text(
        "DATABASE_URL=postgresql+asyncpg://postgres:pw@db.internal:5432/live_invoices\n"
    )
    monkeypatch.setattr(postgres_support, "BACKEND_ROOT", tmp_path)

    with pytest.raises(UnsafeTestDatabaseError, match="backend/.env"):
        assert_safe_test_database(
            "postgresql+asyncpg://postgres:pw@db.internal:5432/live_invoices"
        )


# ---------------------------------------------------------------------------
# Migration behaviour (requires a real PostgreSQL instance)
# ---------------------------------------------------------------------------

async def test_clean_bootstrap_matches_the_supabase_core_schema() -> None:
    """`alembic upgrade head` must reproduce the canonical Supabase schema."""
    async with scratch_database("ia_alembic") as migrated_url, \
            scratch_database("ia_coresql") as reference_url:
        await bootstrap_supabase_stubs(migrated_url)
        await run_alembic(migrated_url, "upgrade", "head")

        await bootstrap_from_core_sql(reference_url)

        expected = await snapshot_schema(reference_url)
        actual = await snapshot_schema(migrated_url)

        assert actual == expected, describe_difference(expected, actual)


async def test_existing_database_upgrades_to_the_current_schema() -> None:
    """A database in the old runtime-DDL shape must upgrade, not be rebuilt."""
    async with scratch_database("ia_legacy") as legacy_url, \
            scratch_database("ia_clean") as clean_url:
        await bootstrap_supabase_stubs(legacy_url)
        await build_legacy_schema(legacy_url)

        # Existing deployments are stamped at the revision matching their shape
        # rather than replayed from scratch.
        await run_alembic(legacy_url, "stamp", LEGACY_STAMP_REVISION)
        await run_alembic(legacy_url, "upgrade", "head")

        await bootstrap_supabase_stubs(clean_url)
        await run_alembic(clean_url, "upgrade", "head")

        expected = await snapshot_schema(clean_url)
        actual = await snapshot_schema(legacy_url)

        assert actual == expected, describe_difference(expected, actual)


async def test_existing_data_survives_the_upgrade() -> None:
    """Upgrading an existing database must preserve the rows already in it."""
    async with scratch_database("ia_legacydata") as legacy_url:
        await bootstrap_supabase_stubs(legacy_url)
        await build_legacy_schema(legacy_url)

        conn = await asyncpg.connect(asyncpg_dsn(legacy_url))
        try:
            user_id = await conn.fetchval(
                "INSERT INTO auth.users (email) VALUES ('owner@example.com') RETURNING id"
            )
            await conn.execute(
                "INSERT INTO public.profiles (id, email) VALUES ($1, 'owner@example.com')",
                user_id,
            )
            client_id = await conn.fetchval(
                "INSERT INTO public.clients (user_id, name) VALUES ($1, 'Acme') RETURNING id",
                user_id,
            )
            await conn.execute(
                """
                INSERT INTO public.client_addresses (client_id, address)
                VALUES ($1, '1 Main St')
                """,
                client_id,
            )
            await conn.execute(
                """
                INSERT INTO public.invoice_records
                    (user_id, filename, file_path, source, chroma_doc_id)
                VALUES ($1, 'inv.pdf', '/tmp/inv.pdf', 'generated', 'doc-1')
                """,
                user_id,
            )
        finally:
            await conn.close()

        await run_alembic(legacy_url, "stamp", LEGACY_STAMP_REVISION)
        await run_alembic(legacy_url, "upgrade", "head")

        conn = await asyncpg.connect(asyncpg_dsn(legacy_url))
        try:
            assert await conn.fetchval("SELECT name FROM public.clients") == "Acme"
            # The rename must carry the value across, not drop the column.
            assert await conn.fetchval("SELECT rag_doc_id FROM public.invoice_records") == "doc-1"
            # Addresses predate per-user ownership and are backfilled from their client.
            assert await conn.fetchval("SELECT user_id FROM public.client_addresses") == user_id
        finally:
            await conn.close()


async def test_downgrade_rolls_the_schema_all_the_way_back() -> None:
    """Rollback must be a real, exercised path rather than a documented hope."""
    async with scratch_database("ia_downgrade") as url:
        await bootstrap_supabase_stubs(url)
        await run_alembic(url, "upgrade", "head")

        assert await application_tables(url), "upgrade head created no tables"

        await run_alembic(url, "downgrade", "base")

        assert await application_tables(url) == set()


async def test_each_revision_downgrades_and_re_upgrades_cleanly() -> None:
    """Stepping back one revision at a time must be reversible."""
    async with scratch_database("ia_stepwise") as url:
        await bootstrap_supabase_stubs(url)
        await run_alembic(url, "upgrade", "head")
        expected = await snapshot_schema(url)

        await run_alembic(url, "downgrade", "-1")
        await run_alembic(url, "upgrade", "head")

        actual = await snapshot_schema(url)
        assert actual == expected, describe_difference(expected, actual)


# ---------------------------------------------------------------------------
# Startup must no longer own the schema
# ---------------------------------------------------------------------------

async def test_startup_refuses_a_database_with_pending_migrations() -> None:
    """Booting against an un-migrated database must fail loudly, not self-heal."""
    from app import database

    async with scratch_database("ia_pending") as url:
        await bootstrap_supabase_stubs(url)

        with pytest.raises(RuntimeError, match="alembic upgrade head"):
            await database.verify_schema_is_current(url)

        assert await application_tables(url) == set(), (
            "startup created schema objects instead of refusing to run"
        )


async def test_startup_accepts_a_fully_migrated_database() -> None:
    from app import database

    async with scratch_database("ia_current") as url:
        await bootstrap_supabase_stubs(url)
        await run_alembic(url, "upgrade", "head")

        await database.verify_schema_is_current(url)


def test_startup_module_no_longer_issues_ddl() -> None:
    source = (BACKEND_ROOT / "app" / "database.py").read_text()

    for banned in ("create_all", "ALTER TABLE", "CREATE TABLE", "CREATE INDEX"):
        assert banned not in source, (
            f"app/database.py still performs DDL ({banned!r}); "
            "schema changes belong in a versioned migration."
        )


# ---------------------------------------------------------------------------
# Operability
# ---------------------------------------------------------------------------

def test_migration_configuration_is_committed() -> None:
    assert ALEMBIC_INI.is_file()
    assert (MIGRATIONS_DIR / "env.py").is_file()
    assert list((MIGRATIONS_DIR / "versions").glob("*.py")), "no migration revisions found"


def test_rollback_is_documented() -> None:
    docs = (REPO_ROOT / "docs" / "migrations.md").read_text().lower()

    assert "alembic downgrade" in docs, "rollback procedure is not documented"
    assert "alembic stamp" in docs, "adopting an existing database is not documented"


def test_migrations_never_hardcode_a_database_url() -> None:
    """Credentials must come from the environment, never the repository."""
    for path in [ALEMBIC_INI, *MIGRATIONS_DIR.rglob("*.py")]:
        text = Path(path).read_text()
        assert "supabase.co" not in text
        assert "postgresql+asyncpg://postgres:" not in text
