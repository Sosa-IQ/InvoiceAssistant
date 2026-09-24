import logging
import re
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.database import engine, init_db
from app.config import settings as app_settings
from app.observability import configure_logging, configure_sentry
from app.services.openai_service import OpenAIService
from app.services.supabase_service import SupabaseService
from app.services.vector_store import VectorStoreService

configure_logging()
configure_sentry()
logger = logging.getLogger(__name__)
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Initialize resources on startup, clean up on shutdown."""
    logger.info("application_starting")

    # Prepare data directories and refuse to start on an unmigrated schema.
    await init_db()

    supabase = SupabaseService()
    await supabase.ensure_bucket()

    app.state.vector_store = VectorStoreService(OpenAIService())

    logger.info("application_ready")
    yield

    logger.info("application_stopping")


app = FastAPI(
    title="Cuenvia API",
    version="0.1.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def request_observability(request: Request, call_next):
    incoming_id = request.headers.get("x-request-id", "")
    request_id = incoming_id if _SAFE_REQUEST_ID.fullmatch(incoming_id) else str(uuid.uuid4())
    request.state.request_id = request_id
    started = time.perf_counter()

    try:
        response = await call_next(request)
    except Exception as exc:
        logger.exception(
            "request_failed",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": 500,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                "exception_type": type(exc).__name__,
            },
        )
        raise

    response.headers["X-Request-ID"] = request_id
    logger.info(
        "request_complete",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        },
    )
    return response


def _cors_allow_origins() -> list[str]:
    """Browser origins permitted to call the API with credentials."""
    origins = [app_settings.frontend_url]
    # Local Vite remains allowed outside strict production so hybrid debugging works.
    if app_settings.app_environment.strip().lower() not in {"production", "prod"}:
        for origin in ("http://localhost:5173", "http://127.0.0.1:5173"):
            if origin not in origins:
                origins.append(origin)
    return origins


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allow_origins(),
    # Vercel preview deployments: https://<branch>-<team>.vercel.app
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def database_is_ready() -> bool:
    try:
        async with engine.connect() as conn:
            return bool(await conn.scalar(text("SELECT 1")))
    except Exception as exc:
        logger.warning(
            "readiness_database_unavailable",
            extra={"exception_type": type(exc).__name__},
        )
        return False


@app.get("/health/live", tags=["health"])
async def health_live() -> dict[str, str]:
    return {"status": "live"}


@app.get("/health/ready", tags=["health"])
async def health_ready():
    if not await database_is_ready():
        return JSONResponse(status_code=503, content={"status": "not_ready"})
    return {"status": "ready"}


# Routers
from app.api import auth, billing, catalog, clients, invoices, settings, voice  # noqa: E402

app.include_router(auth.router)
app.include_router(billing.router)
app.include_router(invoices.router)
app.include_router(clients.router)
app.include_router(catalog.router)
app.include_router(settings.router)
app.include_router(voice.router)
