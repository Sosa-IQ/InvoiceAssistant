"""Alembic environment.

The database URL always comes from ``DATABASE_URL`` (process env, ``backend/.env``,
or ``-x db_url=...``), never from ``alembic.ini``, so migrations can be pointed
at a throwaway CI database without any committed credentials.

Autogenerate is intentionally not wired to ``Base.metadata``: the deployed
schema uses Supabase conventions (``bigint`` identity keys, ``timestamptz``)
that the ORM models do not spell out, so revisions are written by hand and
verified against ``supabase/setup_invoice_assistant_core.sql`` in the tests.
"""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy.pool import NullPool

# Same convention as the FastAPI app: credentials live in backend/.env for local
# dev. Explicit process env / -x db_url still win (load_dotenv does not override).
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(_BACKEND_ROOT / ".env", override=False)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def get_database_url() -> str:
    url = context.get_x_argument(as_dictionary=True).get("db_url") or os.environ.get(
        "DATABASE_URL"
    )
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Add it to backend/.env, export it, or pass "
            "-x db_url=... before running Alembic."
        )
    # Supabase dashboard copies often use postgresql://; the app and this env
    # both use the async SQLAlchemy driver.
    if url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://") :]
    elif url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://") :]
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=get_database_url(),
        target_metadata=None,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=None)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    config.set_main_option("sqlalchemy.url", get_database_url())
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
