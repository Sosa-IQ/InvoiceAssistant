# Backup and recovery runbook

## Recovery objectives

Initial operating targets:

- **RPO:** 24 hours (daily backup)
- **RTO:** 4 hours for a small owner-only deployment
- **Retention:** backups younger than 30 days (age-based pruning)

Review these targets after production usage and data volume are known.

## What the repository backup contains

`backend/scripts/backup_recovery.py` creates a timestamped directory containing:

- PostgreSQL custom-format dump (`database.dump`)
- local `DATA_DIR/invoices` archive when that directory exists
- `manifest.json` with byte counts, SHA-256 checksums, timestamp, and expected Alembic revision

The script does not print database credentials. PostgreSQL client tools must use the same major version as the server. Override PATH selection with `PG_DUMP_BIN`; restore supports `PG_RESTORE_BIN` and `PSQL_BIN`.

Example:

```bash
cd backend
PG_DUMP_BIN=/path/to/postgresql-17/bin/pg_dump \
  .venv/bin/python scripts/backup_recovery.py \
  --output-root "$HOME/.invoice-assistant/backups"
```

Pruning is disabled unless explicitly requested:

```bash
.venv/bin/python scripts/backup_recovery.py \
  --output-root "$HOME/.invoice-assistant/backups" \
  --retention-days 30 \
  --prune
```

Store backups on encrypted storage outside the application host. A local-only backup does not protect against host loss.
The script forces the output root and each backup directory to mode `0700`, and artifacts/manifests to `0600`. Verify those modes after copying backups to another filesystem.

## Supabase hosted data

A PostgreSQL dump does not include Supabase Storage object bytes. When `SUPABASE_SERVICE_ROLE_KEY` is configured, invoices may be stored in the private `SUPABASE_STORAGE_BUCKET` rather than `DATA_DIR`.

Before production:

1. enable and verify the Supabase plan's database backup/PITR policy;
2. configure a separate private-bucket replication/export process using Supabase's supported S3 or Storage tooling;
3. keep that destination private and encrypted;
4. test restoring both the database rows and referenced PDF objects.

Do not assume database backups include Storage.

## Restore verification

Never restore over the configured application database. Create a new, empty loopback database and run:

```bash
cd backend
PG_RESTORE_BIN=/path/to/postgresql-17/bin/pg_restore \
PSQL_BIN=/path/to/postgresql-17/bin/psql \
  .venv/bin/python scripts/restore_verify.py \
  "$HOME/.invoice-assistant/backups/backup-YYYYMMDDTHHMMSSZ" \
  --target-url postgresql+asyncpg://localhost:5432/invoice_restore_test
```

The verifier:

1. refuses remote targets;
2. refuses the configured application database;
3. refuses non-empty public schemas;
4. requires the exact supported artifact set and verifies every byte count and SHA-256 checksum;
5. restores with `--no-owner --no-acl --exit-on-error`;
6. verifies the exact expected Alembic revision;
7. leaves the target intact for inspection.

Afterward, inspect tenant row counts and open representative invoice PDFs. Drop the disposable target manually only after inspection.

If `local-invoices.tar.gz` is present, inspect and extract it only into a new private directory using Python's traversal-safe data filter:

```bash
BACKUP_DIR="$HOME/.invoice-assistant/backups/backup-YYYYMMDDTHHMMSSZ" \
RESTORE_DIR="$HOME/.invoice-assistant/restore-invoices" \
  .venv/bin/python -c 'import os, pathlib, tarfile; src=pathlib.Path(os.environ["BACKUP_DIR"])/"local-invoices.tar.gz"; dst=pathlib.Path(os.environ["RESTORE_DIR"]); dst.mkdir(mode=0o700); tarfile.open(src, "r:gz").extractall(dst, filter="data")'
```

Do not extract over the live `DATA_DIR`. Inspect the restored tree, verify representative PDFs, and copy it into place only during an approved maintenance action.

## Scheduling on macOS

`ops/com.invoiceassistant.backup.plist.template` is an inert daily 02:00 launchd template. Replace every placeholder—including `PG_DUMP_BIN`—with absolute paths. Create the backup and log parent directories with mode `0700`, validate with `plutil -lint`, and inspect the generated command before installing it.

Installing/enabling the LaunchAgent is an operational side effect and is intentionally **not** performed by repository setup. Keep `.env` permissions restricted (`chmod 600`) because the scheduled process reads backend configuration from it.

## Quarterly drill

At least quarterly:

1. pick the newest backup and one older retained backup;
2. restore each into a disposable database;
3. verify checksums and Alembic revision;
4. validate tenant counts and a sample invoice/email history;
5. restore representative private PDF objects;
6. record measured RPO/RTO and remediate misses.

The implementation was exercised locally against PostgreSQL 17 with a real dump/restore and seeded marker verification; repeat the drill in the deployment environment before relying on it.
