import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.db_models import InvoiceRecord
from app.models.schemas import InvoiceRecordRead
from app.services.pdf_parser import PDFParserService
from app.services.storage import StorageService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/invoices", tags=["invoices"])

storage = StorageService()
parser = PDFParserService()


@router.post("/upload", response_model=InvoiceRecordRead)
async def upload_invoice(
    request: Request,
    file: Annotated[UploadFile, File(description="Invoice PDF to upload")],
    db: AsyncSession = Depends(get_db),
) -> InvoiceRecordRead:
    """
    Upload a historical invoice PDF.
    Parses the text, chunks it, embeds it in ChromaDB, and records it in the DB.
    """
    if file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(400, "Only PDF files are accepted.")

    # 1. Save file to disk
    try:
        doc_id, file_path, contents = await storage.save_uploaded_pdf(file)
    except ValueError as e:
        raise HTTPException(413, str(e))

    # 2. Insert a record with status='processing'
    record = InvoiceRecord(
        filename=file.filename or "invoice.pdf",
        file_path=str(file_path),
        source="uploaded",
        chroma_doc_id=doc_id,
        status="processing",
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    # 3. Extract text
    text, is_low_quality = parser.extract_text(contents)

    if is_low_quality:
        logger.warning("Low-quality/scanned PDF detected for doc_id=%s", doc_id)
        record.status = "parse_failed"
        await db.commit()
        await db.refresh(record)
        return InvoiceRecordRead.model_validate(record)

    # 4. Chunk text
    chunks = parser.chunk_text(text)

    # 5. Embed in ChromaDB
    vector_store = request.app.state.vector_store
    vector_store.add_document(
        doc_id=doc_id,
        chunks=chunks,
        metadata={"filename": file.filename or "invoice.pdf"},
    )

    # 6. Extract metadata hints and update record
    hints = parser.extract_metadata_hints(text)
    record.invoice_number = hints.get("invoice_number")
    record.issue_date = hints.get("issue_date")
    record.grand_total = hints.get("grand_total")
    record.status = "indexed"

    await db.commit()
    await db.refresh(record)

    logger.info(
        "Indexed invoice doc_id=%s with %d chunks. Hints: %s",
        doc_id, len(chunks), hints,
    )

    return InvoiceRecordRead.model_validate(record)


@router.get("", response_model=list[InvoiceRecordRead])
async def list_invoices(
    db: AsyncSession = Depends(get_db),
) -> list[InvoiceRecordRead]:
    """Return all invoice records ordered by most recently added."""
    result = await db.execute(
        select(InvoiceRecord).order_by(InvoiceRecord.created_at.desc())
    )
    records = result.scalars().all()
    return [InvoiceRecordRead.model_validate(r) for r in records]
