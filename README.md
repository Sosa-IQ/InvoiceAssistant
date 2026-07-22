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

Run `supabase/setup_invoice_assistant_core.sql` in the Supabase SQL editor. For a database created from an older version of that schema, also review `supabase/add_per_client_invoice_numbering.sql`; backend startup applies compatibility migrations, but the core SQL file is the canonical fresh-install schema.

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
