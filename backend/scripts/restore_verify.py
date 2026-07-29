#!/usr/bin/env python3
"""Verify checksums and restore a backup into a distinct empty loopback database."""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.database import EXPECTED_SCHEMA_REVISION


def postgres_cli_url(url: str) -> str:
    return url.replace("postgresql+asyncpg://", "postgresql://", 1)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def database_identity(url: str) -> tuple[str, int, str]:
    parsed = urlparse(postgres_cli_url(url))
    if parsed.scheme not in {"postgresql", "postgres"} or not parsed.hostname:
        raise ValueError("Restore target must be PostgreSQL.")
    host = parsed.hostname.lower()
    if host in {"localhost", "127.0.0.1", "::1"}:
        host = "loopback"
    encoded_database = parsed.path.lstrip("/")
    if re.search(r"%(?![0-9a-fA-F]{2})", encoded_database):
        raise ValueError("Restore target database name has invalid percent encoding.")
    try:
        database = unquote(encoded_database, errors="strict")
    except UnicodeDecodeError as exc:
        raise ValueError("Restore target database name has invalid UTF-8 encoding.") from exc
    if not database:
        raise ValueError("Restore target must name a database.")
    return host, parsed.port or 5432, database


def validate_target(target_url: str) -> str:
    cli_url = postgres_cli_url(target_url)
    target_identity = database_identity(cli_url)
    if target_identity[0] != "loopback":
        raise ValueError("Restore verification is restricted to loopback PostgreSQL.")
    if target_identity == database_identity(settings.database_url):
        raise ValueError("Restore target must not be the configured application database.")
    return cli_url


def validate_manifest(backup_dir: Path, manifest: object) -> list[Path]:
    if not isinstance(manifest, dict) or set(manifest) != {
        "created_at",
        "expected_schema_revision",
        "artifacts",
    }:
        raise ValueError("manifest must use the exact supported top-level schema")
    created_at = manifest["created_at"]
    if not isinstance(created_at, str):
        raise ValueError("manifest created_at must be an ISO timestamp")
    try:
        datetime.fromisoformat(created_at)
    except ValueError as exc:
        raise ValueError("manifest created_at must be an ISO timestamp") from exc
    if manifest["expected_schema_revision"] != EXPECTED_SCHEMA_REVISION:
        raise ValueError("manifest schema revision does not match this application")
    if not isinstance(manifest.get("artifacts"), dict):
        raise ValueError("manifest artifacts must be an object")
    artifacts = manifest["artifacts"]
    names = set(artifacts)
    supported = {"database.dump", "local-invoices.tar.gz"}
    if "database.dump" not in names or not names <= supported:
        raise ValueError("manifest must contain database.dump and only supported artifacts")

    verified: list[Path] = []
    for name, metadata in artifacts.items():
        if Path(name).name != name or Path(name).is_absolute():
            raise ValueError(f"unsafe artifact name: {name}")
        if not isinstance(metadata, dict) or set(metadata) != {"bytes", "sha256"}:
            raise ValueError(f"invalid metadata for {name}")
        artifact = backup_dir / name
        expected_bytes = metadata.get("bytes")
        expected_sha = metadata.get("sha256")
        if (
            artifact.is_symlink()
            or not artifact.is_file()
            or isinstance(expected_bytes, bool)
            or not isinstance(expected_bytes, int)
            or expected_bytes < 0
            or artifact.stat().st_size != expected_bytes
            or not isinstance(expected_sha, str)
            or re.fullmatch(r"[0-9a-f]{64}", expected_sha) is None
            or sha256_file(artifact) != expected_sha
        ):
            raise ValueError(f"checksum or byte-count mismatch for {name}")
        verified.append(artifact)
    return verified


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup_dir", type=Path)
    parser.add_argument("--target-url", required=True)
    args = parser.parse_args()

    try:
        target_url = validate_target(args.target_url)
    except ValueError as exc:
        parser.error(str(exc))

    backup_dir = args.backup_dir.expanduser().resolve()
    manifest_path = backup_dir / "manifest.json"
    database_file = backup_dir / "database.dump"
    if not manifest_path.is_file() or not database_file.is_file():
        print("FAIL: backup directory must contain manifest.json and database.dump.")
        return 2

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        validate_manifest(backup_dir, manifest)
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"FAIL: invalid backup manifest: {exc}.")
        return 1

    pg_restore = os.environ.get("PG_RESTORE_BIN") or shutil.which("pg_restore")
    psql = os.environ.get("PSQL_BIN") or shutil.which("psql")
    if not pg_restore or not psql:
        print("FAIL: pg_restore and psql must be on PATH.")
        return 2

    table_count = subprocess.run(
        [
            psql,
            target_url,
            "--no-psqlrc",
            "--tuples-only",
            "--no-align",
            "--command",
            "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';",
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if table_count != "0":
        print("FAIL: restore target public schema is not empty.")
        return 2

    subprocess.run(
        [
            pg_restore,
            "--exit-on-error",
            "--no-owner",
            "--no-acl",
            "--dbname",
            target_url,
            str(database_file),
        ],
        check=True,
    )
    revision = subprocess.run(
        [
            psql,
            target_url,
            "--no-psqlrc",
            "--tuples-only",
            "--no-align",
            "--command",
            "SELECT version_num FROM alembic_version;",
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if revision != EXPECTED_SCHEMA_REVISION:
        print(f"FAIL: restored schema revision is {revision!r}, expected {EXPECTED_SCHEMA_REVISION!r}.")
        return 1

    print(f"OK: checksums verified and schema restored at revision {revision}.")
    print("INFO: restore target was not dropped; inspect it, then remove it manually.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
