# Invoice Assistant

Invoice Assistant is a private, authenticated invoice workflow built with FastAPI, React, and Supabase. It supports client/catalog management, AI-assisted invoice generation, PDF export, per-client numbering, private RAG indexing, and direct invoice email delivery with send history.

## Prerequisites

- Python 3.11
- Node.js and npm
- A Supabase project with PostgreSQL, Auth, Storage, and pgvector
- OpenAI credentials for generation/RAG features
- SMTP credentials for direct invoice delivery
- Optional Stripe account and CLI for subscription test mode
- On macOS, WeasyPrint and its native libraries:

```bash
brew install weasyprint
```

## Supabase setup

Choose one schema bootstrap path:

- **Empty PostgreSQL prepared with Supabase-managed objects:** run
  `.venv/bin/alembic upgrade head`.
- **Supabase SQL editor or an existing pre-Alembic deployment:** run
  `supabase/setup_invoice_assistant_core.sql` when setting up a new project,
  then adopt at `0003_rag_and_email` and upgrade so normalization executes:

```bash
cd backend
.venv/bin/alembic stamp 0003_rag_and_email
.venv/bin/alembic upgrade head
```

Do not stamp the newest revision directly. The backend no longer alters schema
at startup; it verifies the exact migration head and refuses to start otherwise.
See [docs/migrations.md](docs/migrations.md) for required backups, older starting
revisions, verification, and rollback costs.

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

The frontend uses `VITE_API_URL` (default `http://localhost:8000`) for the API and attaches the active Supabase access token to API requests.

## Onboarding and subscriptions

New users complete a three-step business setup before entering the workspace. A public pricing page and authenticated billing page support Stripe Checkout, verified subscription webhooks, and the Stripe customer portal. Paid-plan enforcement is off by default.

See [docs/billing.md](docs/billing.md) for test-mode setup, required environment variables, webhook verification, the current Free/Pro boundary, production activation, and safe rollback.

## Invoice email flow

Only exported, owned invoices can be emailed. The backend loads the stored PDF, sends it to the client email saved in the invoice, CCs the authenticated user when an email is available, and records pending/sent/failed delivery history in `invoice_emails`.
