import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.services.vector_store import VectorStoreService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Initialize resources on startup, clean up on shutdown."""
    logger.info("Starting Invoice Assistant API...")

    # Create DB tables and data directories
    await init_db()

    # Initialize ChromaDB (singleton — shared across all requests)
    vector_store = VectorStoreService()
    vector_store.warmup()  # downloads embedding model if needed
    app.state.vector_store = vector_store

    logger.info("Invoice Assistant API is ready.")
    yield

    logger.info("Shutting down Invoice Assistant API.")


app = FastAPI(
    title="Invoice Assistant API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
from app.api import catalog, clients, invoices, settings, voice  # noqa: E402

app.include_router(invoices.router)
app.include_router(clients.router)
app.include_router(catalog.router)
app.include_router(settings.router)
app.include_router(voice.router)
