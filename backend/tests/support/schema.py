"""Structural snapshots of a PostgreSQL database, for comparing bootstrap paths.

A migration chain is only trustworthy if the database it produces is
indistinguishable from the one a fresh Supabase install produces. These helpers
capture the parts of the schema that matter for that comparison: columns and
their types, indexes, constraints, row level security, and policies.
"""

from __future__ import annotations

from typing import Any

import asyncpg

from tests.support.postgres import asyncpg_dsn

_COLUMNS_SQL = """
SELECT table_name,
       column_name,
       data_type,
       udt_name,
       is_nullable,
       column_default,
       is_identity,
       identity_generation,
       character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name <> 'alembic_version'
ORDER BY table_name, column_name
"""

_INDEXES_SQL = """
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename <> 'alembic_version'
ORDER BY tablename, indexname
"""

_CONSTRAINTS_SQL = """
SELECT rel.relname AS table_name,
       con.conname AS name,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname <> 'alembic_version'
ORDER BY rel.relname, con.conname
"""

_RLS_SQL = """
SELECT relname AS table_name, relrowsecurity AS enabled
FROM pg_class
JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
WHERE nspname = 'public' AND relkind = 'r'
  AND relname <> 'alembic_version'
ORDER BY relname
"""

_POLICIES_SQL = """
SELECT tablename, policyname, cmd, roles::text, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename <> 'alembic_version'
ORDER BY tablename, policyname
"""

# Privileges are part of the security surface: a table the `authenticated` role
# cannot reach is as broken as one it can reach without a policy.
_TABLE_GRANTS_SQL = """
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name <> 'alembic_version'
  AND grantee = 'authenticated'
ORDER BY grantee, table_name, privilege_type
"""

_SEQUENCE_GRANTS_SQL = """
SELECT cls.relname AS sequence_name,
       has_sequence_privilege('authenticated', cls.oid, 'USAGE') AS authenticated_usage,
       has_sequence_privilege('authenticated', cls.oid, 'SELECT') AS authenticated_select
FROM pg_class cls
JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
WHERE nsp.nspname = 'public' AND cls.relkind = 'S'
ORDER BY cls.relname
"""


async def snapshot_schema(url: str) -> dict[str, Any]:
    conn = await asyncpg.connect(asyncpg_dsn(url))
    try:
        return {
            "columns": [dict(r) for r in await conn.fetch(_COLUMNS_SQL)],
            "indexes": [dict(r) for r in await conn.fetch(_INDEXES_SQL)],
            "constraints": [dict(r) for r in await conn.fetch(_CONSTRAINTS_SQL)],
            "row_level_security": [dict(r) for r in await conn.fetch(_RLS_SQL)],
            "policies": [dict(r) for r in await conn.fetch(_POLICIES_SQL)],
            "table_grants": [dict(r) for r in await conn.fetch(_TABLE_GRANTS_SQL)],
            "sequence_grants": [dict(r) for r in await conn.fetch(_SEQUENCE_GRANTS_SQL)],
        }
    finally:
        await conn.close()


async def application_tables(url: str) -> set[str]:
    """Return public tables, excluding Alembic's own bookkeeping table."""
    conn = await asyncpg.connect(asyncpg_dsn(url))
    try:
        rows = await conn.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        )
    finally:
        await conn.close()
    return {r["tablename"] for r in rows} - {"alembic_version"}


def describe_difference(expected: dict[str, Any], actual: dict[str, Any]) -> str:
    """Render a readable diff so a schema mismatch is actionable."""
    lines: list[str] = []
    for section in expected:
        missing = [item for item in expected[section] if item not in actual[section]]
        extra = [item for item in actual[section] if item not in expected[section]]
        if missing or extra:
            lines.append(f"{section}:")
            lines.extend(f"  only in expected: {item}" for item in missing)
            lines.extend(f"  only in actual:   {item}" for item in extra)
    return "\n".join(lines) or "(no differences)"
