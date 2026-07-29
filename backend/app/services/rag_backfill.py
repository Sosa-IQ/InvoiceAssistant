"""Backfill embeddings when a tenant becomes Pro."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import InvoiceRecord
from app.services.pdf_parser import PDFParserService

logger = logging.getLogger(__name__)
parser = PDFParserService()


async def backfill_embeddings_for_user(
    db: AsyncSession,
    *,
    user_id: str,
    vector_store,
    limit: int = 500,
) -> int:
    """Embed previously stored Free-tier invoices after Pro activation."""
    from app.api.invoices import _auto_index_record

    result = await db.execute(
        select(InvoiceRecord)
        .where(
            InvoiceRecord.user_id == user_id,
            InvoiceRecord.rag_doc_id.is_(None),
        )
        .order_by(InvoiceRecord.created_at.asc())
        .limit(limit)
    )
    records = list(result.scalars().all())
    indexed = 0
    for record in records:
        try:
            if record.invoice_json:
                await _auto_index_record(
                    db, vector_store=vector_store, user_id=user_id, record=record
                )
                indexed += 1
                continue

            path = Path(record.file_path) if record.file_path else None
            if not path or not path.exists():
                continue
            pdf_bytes = path.read_bytes()
            text, low = parser.extract_text(pdf_bytes)
            if low or not text.strip():
                continue
            doc_id = str(uuid.uuid4())
            chunks = parser.chunk_text(text)
            await vector_store.add_document(
                db,
                doc_id=doc_id,
                user_id=user_id,
                invoice_record_id=record.id,
                filename=record.filename,
                chunks=chunks,
            )
            record.rag_doc_id = doc_id
            record.status = "indexed"
            await db.commit()
            indexed += 1
        except Exception as exc:
            logger.warning(
                "rag_backfill_row_failed",
                extra={"exception_type": type(exc).__name__, "record_id": record.id},
            )
            await db.rollback()
    logger.info("rag_backfill_completed", extra={"user_id": user_id, "indexed": indexed})
    return indexed
