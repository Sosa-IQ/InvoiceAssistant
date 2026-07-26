"""Runs the real Alembic CLI against a test database.

Tests invoke the same entry point CI and operators use, so a migration that
only works when driven programmatically still fails here.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from tests.support.postgres import BACKEND_ROOT


def _alembic_executable() -> list[str]:
    candidate = Path(sys.executable).parent / "alembic"
    if candidate.exists():
        return [str(candidate)]
    return [sys.executable, "-m", "alembic"]


async def run_alembic(url: str, *args: str) -> str:
    env = {**os.environ, "DATABASE_URL": url}
    process = await asyncio.create_subprocess_exec(
        *_alembic_executable(),
        *args,
        cwd=str(BACKEND_ROOT),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    stdout, _ = await process.communicate()
    output = stdout.decode()
    if process.returncode != 0:
        raise AssertionError(f"alembic {' '.join(args)} failed:\n{output}")
    return output


async def upgrade_to_head(url: str) -> str:
    return await run_alembic(url, "upgrade", "head")
