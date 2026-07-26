# Testing

## Layers

| Suite | Needs a database | What it covers |
| --- | --- | --- |
| `test_auth.py`, `test_api_security.py` | no | Token handling; every private route rejects unauthenticated callers. |
| `test_email_workflow.py`, `test_pdf_generator.py` | no | Email construction and header-injection rejection; PDF totals and rendering. |
| `test_supabase_schema.py`, `test_ci_workflow.py` | no | The Supabase schema file and the CI workflow as checked-in configuration. |
| `test_migrations.py` | **yes** | Clean bootstrap, existing-database upgrade, data preservation, rollback. |
| `test_tenant_isolation.py` | **yes** | Two-user isolation across every owned table and route, plus direct RLS checks as PostgreSQL `authenticated`. |

The database-backed suites are skipped unless `TEST_DATABASE_URL` is set, so
`pytest` works out of the box without PostgreSQL installed.

## Running everything

```bash
cd backend
TEST_DATABASE_URL='postgresql+asyncpg://postgres@localhost:55432/postgres' \
  .venv/bin/python -m pytest -q
```

Without `TEST_DATABASE_URL`, the database suites skip and the rest still run.

## Local PostgreSQL with pgvector

The database suites need pgvector. Homebrew's `pgvector` builds against
`postgresql@17`:

```bash
brew install postgresql@17 pgvector
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

initdb -D /tmp/invoiceassistant-pg17 -U postgres --auth=trust
pg_ctl -D /tmp/invoiceassistant-pg17 -o "-p 55432 -k /tmp" -l /tmp/pg17.log start
```

If `CREATE EXTENSION vector` reports the extension is unavailable, link
pgvector into the cluster:

```bash
ln -sf /opt/homebrew/opt/pgvector/share/postgresql@17/extension/vector* \
       /opt/homebrew/opt/postgresql@17/share/postgresql@17/extension/
ln -sf /opt/homebrew/opt/pgvector/lib/postgresql@17/vector.so \
       /opt/homebrew/opt/postgresql@17/lib/postgresql/
```

Stop it when you are done:

```bash
pg_ctl -D /tmp/invoiceassistant-pg17 stop
```

## Safety

These suites create and drop databases, so `tests/support/postgres.py` refuses
to run when `TEST_DATABASE_URL`:

- is not a loopback host (`localhost`, `127.0.0.1`, or `::1`),
- points at a managed Supabase host (`*.supabase.co`, `.com`, `.net`), or
- is the same database as `DATABASE_URL`.

These guards are themselves tested, and they run without a database so the
guard is verified on every `pytest` invocation. Never point
`TEST_DATABASE_URL` at a database you care about: each test creates its own
uniquely named scratch database and drops it afterwards.

## How the isolation tests work

`test_tenant_isolation.py` seeds two tenants — Alice and Bob — through the
real HTTP API against a migrated database. Each tenant gets business settings,
a client, an address, a catalog item, an exported invoice with a real rendered
PDF, pgvector embeddings, and email history. Bob then tries to read, modify,
and delete Alice's rows on every route.

Only genuinely external I/O is replaced:

- **OpenAI** — a deterministic bag-of-words embedder, so pgvector similarity
  search runs for real without spending tokens. Completions are captured so
  tests can assert exactly which clients, catalog items, and retrieved
  documents were placed in the prompt.
- **SMTP** — outbound mail is captured in memory.
- **Supabase Storage network I/O** — the service-role key is cleared by the
  harness even if a developer's local `.env` contains one, so generated PDFs
  are still written and served from the temporary local data directory without
  contacting a live project.

Everything that could leak data — route handlers, SQLAlchemy queries, the
pgvector `user_id` filter, cascade behaviour — is the real implementation.

### Keeping the tests honest

Isolation tests fail silently if they assert "the other tenant's data is
absent" in a situation where *no* data would be returned anyway. The RAG test
guards against this explicitly: it queries with one tenant's own indexed text
and asserts that exactly one document comes back and that it is the querying
tenant's, so a dropped `WHERE user_id` filter is caught rather than masked by
an empty result.

If you add an isolation test, verify it by temporarily removing the filter it
covers and confirming the test fails.

## Live Supabase

Nothing in the suite talks to a live Supabase project. The tenant-isolation
harness always clears the Storage service-role key, regardless of values in the
process environment or a developer's local `.env`. PDFs are therefore written
to a temporary local directory and `storage_path` stays `NULL`. Storage bucket
policies and real Supabase Auth token verification are **not** covered by
automated tests and still need manual verification against a real project.
