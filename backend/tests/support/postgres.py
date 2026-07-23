"""Helpers for tests that need a real PostgreSQL database.

These tests are opt-in: they run only when ``TEST_DATABASE_URL`` points at a
throwaway PostgreSQL instance with pgvector available, and they are skipped
otherwise so the default suite stays hermetic.

Every helper here creates and drops scratch databases, so the guard rails
below exist to make it impossible to aim that destruction at a real project.
"""

from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest

REPO_ROOT = Path(__file__).parents[3]
BACKEND_ROOT = REPO_ROOT / "backend"
SUPABASE_DIR = REPO_ROOT / "supabase"
STUBS_SQL = SUPABASE_DIR / "testing" / "supabase_stubs.sql"
CORE_SQL = SUPABASE_DIR / "setup_invoice_assistant_core.sql"

_ENV_VAR = "TEST_DATABASE_URL"

# A managed Supabase project is never an acceptable target: these helpers issue
# DROP DATABASE and rewrite schemas wholesale.
_FORBIDDEN_HOST_SUFFIXES = (".supabase.co", ".supabase.com", ".supabase.net")
_ALLOWED_TEST_HOSTS = {"localhost", "127.0.0.1", "::1"}


class UnsafeTestDatabaseError(RuntimeError):
    """Raised when the configured test database could destroy real data."""


def assert_safe_test_database(url: str) -> None:
    """Reject any test database URL that could point at real data."""
    host = (urlsplit(url).hostname or "").lower()

    if any(host.endswith(suffix) for suffix in _FORBIDDEN_HOST_SUFFIXES):
        raise UnsafeTestDatabaseError(
            f"{_ENV_VAR} points at a managed Supabase host ({host}). "
            "Tenant-isolation and migration tests create and drop databases and "
            "must only ever run against a disposable local or CI instance."
        )

    if host not in _ALLOWED_TEST_HOSTS:
        raise UnsafeTestDatabaseError(
            f"{_ENV_VAR} must use a loopback PostgreSQL host; found {host or 'none'}. "
            "Destructive tests are limited to localhost/127.0.0.1/::1."
        )

    for source, configured in _application_database_urls():
        if configured and _normalize(configured) == _normalize(url):
            raise UnsafeTestDatabaseError(
                f"{_ENV_VAR} is identical to DATABASE_URL (from {source}). Point "
                "the tests at a separate throwaway database so the application "
                "database is never dropped or rewritten."
            )


def _application_database_urls() -> list[tuple[str, str | None]]:
    """Every place the application database URL can come from.

    Checking only the environment would miss a URL configured solely in
    ``backend/.env``, which is the normal way a developer points the app at a
    real project.
    """
    sources: list[tuple[str, str | None]] = [
        ("environment", os.environ.get("DATABASE_URL"))
    ]

    # Read the file directly: environment variables take precedence over .env
    # in Settings, so loading config would hide the value stored on disk.
    env_file = BACKEND_ROOT / ".env"
    if env_file.is_file():
        try:
            from dotenv import dotenv_values

            sources.append(("backend/.env", dotenv_values(env_file).get("DATABASE_URL")))
        except Exception:  # noqa: BLE001 - unreadable config is not a test failure
            pass

    return sources


def _normalize(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.hostname}:{parts.port}{parts.path}".lower()


def test_database_url() -> str:
    """Return the opt-in test database URL, skipping the test when unset."""
    url = os.environ.get(_ENV_VAR)
    if not url:
        pytest.skip(
            f"{_ENV_VAR} is not set; skipping tests that require a real PostgreSQL database."
        )

    assert_safe_test_database(url)
    return url


def asyncpg_dsn(url: str) -> str:
    """Convert a SQLAlchemy URL into a plain DSN that asyncpg accepts."""
    parts = urlsplit(url)
    scheme = parts.scheme.split("+", 1)[0]
    return urlunsplit((scheme, parts.netloc, parts.path, "", ""))


def with_database(url: str, database: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{database}", parts.query, parts.fragment))


@asynccontextmanager
async def scratch_database(prefix: str = "ia_test"):
    """Create a uniquely named empty database and drop it afterwards."""
    import asyncpg

    base_url = test_database_url()
    name = f"{prefix}_{uuid.uuid4().hex[:12]}"

    admin = await asyncpg.connect(asyncpg_dsn(base_url))
    try:
        await admin.execute(f'CREATE DATABASE "{name}"')
    finally:
        await admin.close()

    try:
        yield with_database(base_url, name)
    finally:
        admin = await asyncpg.connect(asyncpg_dsn(base_url))
        try:
            # Terminate stragglers so the drop cannot block on a leaked session.
            await admin.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = $1 AND pid <> pg_backend_pid()",
                name,
            )
            await admin.execute(f'DROP DATABASE IF EXISTS "{name}"')
        finally:
            await admin.close()


async def apply_sql_file(dsn: str, path: Path) -> None:
    import asyncpg

    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(path.read_text())
    finally:
        await conn.close()


async def bootstrap_supabase_stubs(url: str) -> None:
    """Create the Supabase-managed objects the core schema depends on."""
    await apply_sql_file(asyncpg_dsn(url), STUBS_SQL)


async def bootstrap_from_core_sql(url: str) -> None:
    """Build a database the way a fresh Supabase install does."""
    await bootstrap_supabase_stubs(url)
    await apply_sql_file(asyncpg_dsn(url), CORE_SQL)
