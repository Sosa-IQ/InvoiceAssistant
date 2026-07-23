"""Harness for driving the real API against a real PostgreSQL database.

Tenant isolation is a property of the whole request path -- route handler,
SQLAlchemy query, and pgvector filter together -- so these tests exercise the
actual FastAPI app over HTTP against a migrated database rather than calling
functions directly.

Only genuinely external I/O is replaced: OpenAI embeddings/completions,
SMTP, and Supabase Storage network calls. Everything that could leak one
tenant's data into another's response is the real implementation.
"""

from __future__ import annotations

import hashlib
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import asyncpg
import httpx
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from tests.support.postgres import asyncpg_dsn

EMBEDDING_DIMENSIONS = 1536


class FakeOpenAIService:
    """Deterministic stand-in for the OpenAI client.

    Embeddings are a bag-of-words hash, so identical text always produces an
    identical vector and unrelated text produces a distant one. That is enough
    to prove pgvector queries are filtered by owner without spending tokens.
    """

    def __init__(self) -> None:
        self.generate_calls: list[dict] = []

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [self._embed(text) for text in texts]

    @staticmethod
    def _embed(text: str) -> list[float]:
        vector = [0.0] * EMBEDDING_DIMENSIONS
        for token in text.lower().split():
            digest = hashlib.sha256(token.encode()).digest()
            index = int.from_bytes(digest[:4], "big") % EMBEDDING_DIMENSIONS
            vector[index] += 1.0
        if not any(vector):
            vector[0] = 1.0
        return vector

    def generate_invoice(self, **kwargs):
        """Record the prompt context so tests can assert what the model saw."""
        from app.models.schemas import InvoiceData

        self.generate_calls.append(kwargs)
        return InvoiceData.model_validate(
            {
                "invoice_number": None,
                "issue_date": "2026-07-23",
                "status": "draft",
                "from": {"name": "Test Co"},
                "to": {"client_id": None, "name": None},
                "line_items": [
                    {
                        "description": "Work",
                        "quantity": 1,
                        "unit": "item",
                        "unit_price": 10,
                        "subtotal": 10,
                    }
                ],
                "totals": {"subtotal": 10, "grand_total": 10},
            }
        )


@dataclass
class Tenant:
    """One authenticated user plus the ids of the rows it owns."""

    id: str
    email: str
    client_id: int | None = None
    address_id: int | None = None
    catalog_item_id: int | None = None
    invoice_record_id: int | None = None
    email_history_id: int | None = None
    rag_doc_id: str | None = None
    extras: dict = field(default_factory=dict)


class SentEmails:
    """Captures outbound mail instead of talking to an SMTP server."""

    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def __call__(self, **kwargs) -> str:
        self.sent.append(kwargs)
        return f"<{uuid.uuid4()}@test>"


async def create_tenant(url: str, email: str) -> Tenant:
    """Create an auth user and its profile, the way Supabase signup would."""
    conn = await asyncpg.connect(asyncpg_dsn(url))
    try:
        user_id = await conn.fetchval(
            "INSERT INTO auth.users (email) VALUES ($1) RETURNING id", email
        )
        await conn.execute(
            "INSERT INTO public.profiles (id, email) VALUES ($1, $2)", user_id, email
        )
    finally:
        await conn.close()
    return Tenant(id=str(user_id), email=email)


@asynccontextmanager
async def api_client(url: str, tenants: dict[str, Tenant], data_dir):
    """Yield (request_fn, harness) wired to the migrated database in `url`.

    `request_fn(tenant, method, path, ...)` issues an authenticated request as
    that tenant. Switching tenants switches only the identity, exactly as a
    different bearer token would.
    """
    from app import auth
    from app.api import invoices as invoices_api
    from app.config import settings as app_settings
    from app.database import get_db
    from app.main import app
    from app.services.vector_store import VectorStoreService

    engine = create_async_engine(url, echo=False)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    fake_openai = FakeOpenAIService()
    sent_emails = SentEmails()

    original_data_dir = app_settings.data_dir
    original_supabase_service_role_key = app_settings.supabase_service_role_key
    original_send = invoices_api.email_svc.send_invoice_email
    original_generate = invoices_api.openai_svc.generate_invoice
    original_overrides = dict(app.dependency_overrides)
    had_vector_store = hasattr(app.state, "vector_store")
    original_vector_store = getattr(app.state, "vector_store", None)

    try:
        app_settings.data_dir = data_dir
        # Tests must never contact live Supabase Storage, even when a developer's
        # backend/.env contains a real service-role key. The storage service reads
        # settings dynamically, so clearing the key forces its local-disk path.
        app_settings.supabase_service_role_key = ""
        invoices_api.email_svc.send_invoice_email = sent_emails
        invoices_api.openai_svc.generate_invoice = fake_openai.generate_invoice
        app.state.vector_store = VectorStoreService(fake_openai)

        current: dict[str, Tenant] = {}

        async def override_get_db():
            async with session_factory() as session:
                yield session

        async def override_current_user() -> auth.AuthenticatedUser:
            tenant = current["tenant"]
            return auth.AuthenticatedUser(id=tenant.id, email=tenant.email)

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[auth.get_current_user] = override_current_user

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as http:

            async def request(
                tenant: Tenant, method: str, path: str, **kwargs
            ) -> httpx.Response:
                current["tenant"] = tenant
                return await http.request(method, path, **kwargs)

            harness = {
                "openai": fake_openai,
                "emails": sent_emails,
                "session_factory": session_factory,
                "tenants": tenants,
            }
            yield request, harness
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original_overrides)
        invoices_api.email_svc.send_invoice_email = original_send
        invoices_api.openai_svc.generate_invoice = original_generate
        app_settings.data_dir = original_data_dir
        app_settings.supabase_service_role_key = original_supabase_service_role_key
        if had_vector_store:
            app.state.vector_store = original_vector_store
        elif hasattr(app.state, "vector_store"):
            del app.state.vector_store
        await engine.dispose()
