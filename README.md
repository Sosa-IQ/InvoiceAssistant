# Invoice Assistant

Invoice Assistant is a private, authenticated invoice workflow built with FastAPI, React, and Supabase. It supports client/catalog management, AI-assisted invoice generation, PDF export, per-client numbering, private RAG indexing, and direct invoice email delivery with send history.

## Prerequisites

- Python 3.11
- Node.js and npm
- A Supabase project with PostgreSQL, Auth, Storage, and pgvector
- OpenAI credentials for generation/RAG features
- SMTP credentials for direct invoice delivery
- On macOS, WeasyPrint and its native libraries:

```bash
brew install weasyprint
```

## Supabase setup

Run `supabase/setup_invoice_assistant_core.sql` in the Supabase SQL editor. That file is the canonical fresh-install schema.

Schema changes after that are versioned Alembic migrations. The backend no longer alters the schema at startup — it verifies the database is migrated and refuses to start otherwise:

```bash
cd backend
.venv/bin/alembic upgrade head
```

An existing database is adopted with `alembic stamp head`. See [docs/migrations.md](docs/migrations.md) for the revision history, the rollback procedure, and what a rollback costs.

Copy the environment templates and supply your own secrets:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Do not commit either `.env` file.

## Backend

```bash
cd backend
python3.11 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib .venv/bin/uvicorn app.main:app --reload
```

`DYLD_FALLBACK_LIBRARY_PATH` is needed when Python is not Homebrew-managed on Apple Silicon. It can be omitted if WeasyPrint imports successfully without it.

Run backend tests:

```bash
cd backend
DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib .venv/bin/python -m pytest -q
```

The migration and tenant-isolation suites need a local PostgreSQL with pgvector and are skipped unless `TEST_DATABASE_URL` is set. See [docs/testing.md](docs/testing.md) for the setup and the safety rules that keep those tests away from a real project.

Dependency auditing and the one accepted advisory are documented in [docs/dependencies.md](docs/dependencies.md).

## Frontend

```bash
cd frontend
npm ci
npm run dev
```

Quality checks:

```bash
npm run build
npm run lint
```

The frontend defaults to `http://localhost:8000` for the API and attaches the active Supabase access token to API requests.

## Invoice email flow

Only exported, owned invoices can be emailed. The backend loads the stored PDF, sends it to the client email saved in the invoice, CCs the authenticated user when an email is available, and records pending/sent/failed delivery history in `invoice_emails`.
