#!/usr/bin/env python3
"""Create a PostgreSQL + local invoice backup with a checksum manifest."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

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


def prune_old_backups(root: Path, retention_days: int) -> list[str]:
    cutoff = datetime.now(UTC) - timedelta(days=retention_days)
    removed: list[str] = []
    for child in root.iterdir() if root.exists() else []:
        if not child.is_dir() or not child.name.startswith("backup-"):
            continue
        modified = datetime.fromtimestamp(child.stat().st_mtime, UTC)
        if modified < cutoff:
            shutil.rmtree(child)
            removed.append(child.name)
    return removed


def make_private_directory(path: Path, *, exist_ok: bool) -> None:
    path.mkdir(parents=True, exist_ok=exist_ok, mode=0o700)
    path.chmod(0o700)


def make_private_file(path: Path) -> None:
    path.chmod(0o600)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path.home() / ".invoice-assistant" / "backups",
    )
    parser.add_argument("--retention-days", type=int, default=30)
    parser.add_argument(
        "--prune",
        action="store_true",
        help="Delete backup-* directories older than --retention-days.",
    )
    args = parser.parse_args()

    if args.retention_days < 1:
        parser.error("--retention-days must be at least 1")
    pg_dump = os.environ.get("PG_DUMP_BIN") or shutil.which("pg_dump")
    if not pg_dump:
        print("FAIL: pg_dump is not on PATH.")
        return 2

    created = datetime.now(UTC)
    output_root = args.output_root.expanduser().resolve()
    make_private_directory(output_root, exist_ok=True)
    backup_dir = output_root / created.strftime(
        "backup-%Y%m%dT%H%M%SZ"
    )
    make_private_directory(backup_dir, exist_ok=False)
    database_file = backup_dir / "database.dump"

    try:
        subprocess.run(
            [
                pg_dump,
                "--format=custom",
                "--no-owner",
                "--no-acl",
                "--file",
                str(database_file),
                "--dbname",
                postgres_cli_url(settings.database_url),
            ],
            check=True,
        )
        make_private_file(database_file)

        artifacts = [database_file]
        if settings.invoices_dir.exists():
            invoice_archive = backup_dir / "local-invoices.tar.gz"
            with tarfile.open(invoice_archive, "w:gz") as archive:
                archive.add(settings.invoices_dir, arcname="invoices")
            make_private_file(invoice_archive)
            artifacts.append(invoice_archive)

        manifest = {
            "created_at": created.isoformat(),
            "expected_schema_revision": EXPECTED_SCHEMA_REVISION,
            "artifacts": {
                artifact.name: {
                    "bytes": artifact.stat().st_size,
                    "sha256": sha256_file(artifact),
                }
                for artifact in artifacts
            },
        }
        manifest_path = backup_dir / "manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )
        make_private_file(manifest_path)
    except Exception:
        shutil.rmtree(backup_dir, ignore_errors=True)
        raise

    removed = prune_old_backups(output_root, args.retention_days) if args.prune else []
    print(f"OK: backup created at {backup_dir}")
    print(f"OK: {len(manifest['artifacts'])} artifact(s) checksummed")
    if args.prune:
        print(f"OK: pruned {len(removed)} expired backup(s)")
    else:
        print("INFO: retention pruning not requested")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
