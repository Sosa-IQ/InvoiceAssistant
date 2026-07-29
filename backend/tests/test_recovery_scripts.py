import hashlib
import os
from pathlib import Path

import pytest

from scripts.backup_recovery import make_private_directory, make_private_file
from scripts import restore_verify


def artifact_metadata(path: Path) -> dict[str, object]:
    return {"bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def manifest(artifacts: dict[str, object]) -> dict[str, object]:
    return {
        "created_at": "2026-07-26T00:00:00+00:00",
        "expected_schema_revision": restore_verify.EXPECTED_SCHEMA_REVISION,
        "artifacts": artifacts,
    }


def test_manifest_requires_database_dump(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="database.dump"):
        restore_verify.validate_manifest(tmp_path, manifest({}))


def test_manifest_rejects_unsafe_or_unknown_artifacts(tmp_path: Path) -> None:
    dump = tmp_path / "database.dump"
    dump.write_bytes(b"dump")
    metadata = artifact_metadata(dump)

    with pytest.raises(ValueError, match="supported artifacts"):
        restore_verify.validate_manifest(
            tmp_path,
            manifest({"database.dump": metadata, "../outside": metadata}),
        )


def test_manifest_checks_byte_count_and_checksum(tmp_path: Path) -> None:
    dump = tmp_path / "database.dump"
    dump.write_bytes(b"dump")
    metadata = artifact_metadata(dump)
    metadata["bytes"] = 999

    with pytest.raises(ValueError, match="byte-count"):
        restore_verify.validate_manifest(tmp_path, manifest({"database.dump": metadata}))


def test_manifest_accepts_exact_supported_artifacts(tmp_path: Path) -> None:
    dump = tmp_path / "database.dump"
    archive = tmp_path / "local-invoices.tar.gz"
    dump.write_bytes(b"dump")
    archive.write_bytes(b"archive")

    verified = restore_verify.validate_manifest(
        tmp_path,
        manifest(
            {
                dump.name: artifact_metadata(dump),
                archive.name: artifact_metadata(archive),
            }
        ),
    )

    assert verified == [dump, archive]


def test_manifest_rejects_unknown_schema_fields_and_symlinks(tmp_path: Path) -> None:
    dump = tmp_path / "database.dump"
    real_dump = tmp_path / "real.dump"
    real_dump.write_bytes(b"dump")
    dump.symlink_to(real_dump)
    metadata = artifact_metadata(real_dump)

    extra_top_level = manifest({"database.dump": metadata})
    extra_top_level["unexpected"] = True
    with pytest.raises(ValueError, match="top-level schema"):
        restore_verify.validate_manifest(tmp_path, extra_top_level)

    extra_metadata = dict(metadata)
    extra_metadata["unexpected"] = True
    with pytest.raises(ValueError, match="invalid metadata"):
        restore_verify.validate_manifest(
            tmp_path, manifest({"database.dump": extra_metadata})
        )

    with pytest.raises(ValueError, match="checksum or byte-count"):
        restore_verify.validate_manifest(
            tmp_path, manifest({"database.dump": metadata})
        )


def test_restore_target_rejects_equivalent_loopback_application_url(monkeypatch) -> None:
    monkeypatch.setattr(
        restore_verify.settings,
        "database_url",
        "postgresql+asyncpg://app:secret@localhost:5432/invoice_app?sslmode=require",
    )

    with pytest.raises(ValueError, match="application database"):
        restore_verify.validate_target("postgresql://other@127.0.0.1/invoice_app")
    with pytest.raises(ValueError, match="application database"):
        restore_verify.validate_target("postgresql://other@127.0.0.1/invoice%5Fapp")


def test_restore_target_rejects_invalid_percent_encoding(monkeypatch) -> None:
    monkeypatch.setattr(
        restore_verify.settings,
        "database_url",
        "postgresql+asyncpg://localhost:5432/invoice_app",
    )
    with pytest.raises(ValueError, match="percent encoding"):
        restore_verify.validate_target("postgresql://localhost:5432/invoice%ZZapp")


def test_restore_target_allows_distinct_loopback_database(monkeypatch) -> None:
    monkeypatch.setattr(
        restore_verify.settings,
        "database_url",
        "postgresql+asyncpg://localhost:5432/invoice_app",
    )

    assert restore_verify.validate_target("postgresql://localhost:5432/invoice_restore").endswith(
        "/invoice_restore"
    )


def test_backup_paths_are_owner_only(tmp_path: Path) -> None:
    directory = tmp_path / "backups"
    make_private_directory(directory, exist_ok=False)
    artifact = directory / "database.dump"
    artifact.write_bytes(b"private")
    make_private_file(artifact)

    assert os.stat(directory).st_mode & 0o777 == 0o700
    assert os.stat(artifact).st_mode & 0o777 == 0o600
