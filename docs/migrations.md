# Database migrations

The database schema is owned by versioned Alembic migrations in
`backend/migrations/versions`. Application startup no longer creates or alters
any schema object: `app.database.init_db` only verifies that the database has
been migrated to the revision the running code expects, and refuses to serve
traffic otherwise.

That check is deliberate. Startup DDL made the deployed schema a function of
whichever process last booted, with no version, no review, and no way back.

## Revisions

| Revision | Contents |
| --- | --- |
| `0001_baseline` | Profiles, business settings, clients, client addresses, catalog items, invoice records, plus the row level security policies and `authenticated` grants for those tables. |
| `0002_client_numbering` | `clients.client_code`, `invoice_records.client_id` / `client_invoice_sequence`, and the per-user uniqueness constraints behind `INV-{CLIENTCODE}_{sequence}`. |
| `0003_rag_and_email` | pgvector `invoice_embeddings`, `invoice_emails` history, `invoice_records.storage_path`, the `chroma_doc_id` → `rag_doc_id` rename, and per-user ownership on `client_addresses` (backfilled from each address's client). |
| `0004_normalize_adopted_schema` | Converges databases created by the former startup DDL: ownership constraints, canonical identity/timestamp/text types, duplicate-index cleanup, RLS policies, and `authenticated` grants. |
| `0005_restore_email_defaults` | Restores the `status`, `provider`, and `created_at` server defaults omitted by SQLAlchemy-created `invoice_emails` tables. |
| `0006_email_idempotency` | Durable idempotency metadata (`idempotency_key`, `request_fingerprint`, `attempt_count`, `attempt_token`, `lease_expires_at`) on `invoice_emails`. |
| `0007_security_events` | `security_events` audit table backing durable rate limits, with owner-only `SELECT` RLS. |
| `0008_email_templates` | `business_settings.default_email_subject` / `default_email_message`, tenant-customizable defaults used to compose invoice send emails. |
| `0009_onboarding_state` | Persisted onboarding completion timestamp. Existing settings rows are backfilled complete; settings created afterward start incomplete. |
| `0010_billing` | Tenant subscription state, Stripe identifiers/event ordering, durable Checkout idempotency metadata, and the private webhook-event ledger with forced RLS. |

## Prerequisites

Alembic reads the target database from `DATABASE_URL`. It loads
`backend/.env` the same way the FastAPI app does (process env and
`-x db_url=...` still override). Nothing is committed to `alembic.ini`, so no
credentials live in the repository.

Dashboard-style `postgresql://` / `postgres://` URLs are accepted and normalized
to `postgresql+asyncpg://`.

```bash
cd backend
# either backend/.env contains DATABASE_URL=...
# or:
export DATABASE_URL='postgresql+asyncpg://...'
```

## Applying migrations

```bash
cd backend
.venv/bin/alembic upgrade head
```

Check what is currently applied at any time:

```bash
.venv/bin/alembic current
.venv/bin/alembic history --verbose
```

## Adopting an existing database

A database created by `supabase/setup_invoice_assistant_core.sql` or maintained by
the former startup DDL must run the adoption-normalization revision. Take a
backup first, then record the last pre-adoption revision and upgrade forward:

```bash
cd backend
.venv/bin/alembic stamp 0003_rag_and_email
.venv/bin/alembic upgrade head
```

Do not stamp the newest revision directly. Stamping records a label without
running DDL; doing so would silently preserve nullable ownership, legacy serial
and timestamp columns, missing constraints, or missing grants. Revision
`0004_normalize_adopted_schema` is deliberately idempotent on an already
canonical database and repairs the known former-runtime shape. Revision
`0005_restore_email_defaults` completes adoption by restoring server defaults
that SQLAlchemy-created email tables did not carry.

If a database predates per-client invoice numbering, stamp the revision that
matches its actual shape and then upgrade forward:

```bash
.venv/bin/alembic stamp 0001_baseline
.venv/bin/alembic upgrade head
```

To work out which revision matches, check for the marker columns:

```sql
-- present from 0002 onwards
select 1 from information_schema.columns
 where table_name = 'clients' and column_name = 'client_code';

-- present from 0003 onwards
select 1 from information_schema.columns
 where table_name = 'invoice_records' and column_name = 'rag_doc_id';
```

## Rollback

Revisions through `0003` implement structural downgrades, and the migration
tests exercise both a single-step traversal and a full teardown against a real
PostgreSQL instance. Revisions `0004_normalize_adopted_schema` and
`0005_restore_email_defaults` are intentional no-ops on downgrade: recreating
nullable ownership, legacy column types/defaults, missing RLS, or missing grants
would reintroduce the defects they repair.

Roll back the most recent revision:

```bash
cd backend
.venv/bin/alembic downgrade -1
```

Roll back to a specific revision:

```bash
.venv/bin/alembic downgrade 0002_client_numbering
```

Tear the schema down completely (destroys all application data):

```bash
.venv/bin/alembic downgrade base
```

### What rollback costs

Downgrades are structurally correct but not loss-free. Take a backup first —
on Supabase, via a project backup or `pg_dump` — because:

- `0003` down drops `invoice_embeddings` and `invoice_emails` outright, losing
  every indexed vector and the entire email delivery history. Re-indexing
  invoices restores the embeddings; send history cannot be reconstructed.
- `0003` down drops `client_addresses.user_id` and
  `invoice_records.storage_path`. The address owner is recoverable on re-upgrade
  because it is backfilled from each address's client; the storage path is not,
  and stored PDFs would need to be relinked.
- `0002` down drops `client_code` and `client_invoice_sequence`, so per-client
  invoice numbering restarts. Previously issued invoice numbers remain in
  `invoice_records.invoice_number` as text, but a re-upgrade will renumber from
  scratch and can collide with numbers already sent to clients.
- `0010` down drops local subscription state, Checkout idempotency metadata, and
  the Stripe webhook-event ledger. Never downgrade it after real subscriptions
  exist; disable `BILLING_ENFORCEMENT_ENABLED` instead.
- `0009` down removes onboarding completion timestamps. A later re-upgrade marks
  every settings row that exists at that point complete, so per-user completion
  history cannot be reconstructed.
- `0001` down drops every application table.

After any downgrade, downgrade the application to a matching release as well:
a newer backend refuses to start against an older schema, which is the intended
behaviour.

## Scope

Alembic manages the relational schema in the `public` schema: tables, columns,
indexes, constraints, row level security, policies, and `authenticated` grants.

Two things stay outside it:

- **Supabase-managed objects** (`auth.users`, the `storage` schema, roles).
  Supabase provisions these. `supabase/testing/supabase_stubs.sql` recreates
  just enough of them for CI and local tests, and is never applied to a real
  project.
- **The Storage bucket and its policies**, which live in
  `supabase/setup_invoice_assistant_core.sql`.

`supabase/setup_invoice_assistant_core.sql` remains the canonical fresh-install
path for the Supabase SQL editor. It and the migration chain must produce the
same schema, and
`backend/tests/test_migrations.py::test_clean_bootstrap_matches_the_supabase_core_schema`
fails the build if they ever drift apart.

## Tests

The migration tests need a real PostgreSQL instance with pgvector. They are
skipped unless `TEST_DATABASE_URL` is set, and they refuse every non-loopback
host, a managed Supabase host, or the configured `DATABASE_URL`, because they
create and drop databases.

```bash
cd backend
TEST_DATABASE_URL='postgresql+asyncpg://postgres@localhost:55432/postgres' \
  .venv/bin/python -m pytest tests/test_migrations.py -q
```
