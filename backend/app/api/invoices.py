import logging
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.db_models import BusinessSettings, InvoiceRecord
from app.models.schemas import (
    BulkUploadResponse,
    GenerateInvoiceRequest,
    GenerateInvoiceResponse,
    InvoiceRecordRead,
    UploadResult,
)
from app.services.openai_service import OpenAIService
from app.services.pdf_parser import PDFParserService
from app.services.rag_service import RAGService
from app.services.storage import StorageService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/invoices", tags=["invoices"])

storage = StorageService()
parser = PDFParserService()
openai_svc = OpenAIService()


@router.post("/upload", response_model=BulkUploadResponse)
async def upload_invoices(
    request: Request,
    files: Annotated[list[UploadFile], File(description="One or more invoice PDFs to upload")],
    db: AsyncSession = Depends(get_db),
) -> BulkUploadResponse:
    """
    Upload one or more historical invoice PDFs.
    Each file is parsed, chunked, embedded in ChromaDB, and recorded in the DB.
    Processing continues even if individual files fail (partial-success).
    """
    vector_store = request.app.state.vector_store
    results: list[UploadResult] = []

    for file in files:
        filename = file.filename or "invoice.pdf"

        # Validate content type
        if file.content_type not in ("application/pdf", "application/octet-stream"):
            results.append(UploadResult(
                filename=filename,
                success=False,
                error="Only PDF files are accepted.",
            ))
            logger.warning("Rejected non-PDF file: %s (%s)", filename, file.content_type)
            continue

        # 1. Save file to disk
        try:
            doc_id, file_path, contents = await storage.save_uploaded_pdf(file)
        except ValueError as e:
            results.append(UploadResult(filename=filename, success=False, error=str(e)))
            logger.warning("Failed to save %s: %s", filename, e)
            continue

        # 2. Insert a record with status='processing'
        record = InvoiceRecord(
            filename=filename,
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
            logger.warning("Low-quality/scanned PDF detected for doc_id=%s (%s)", doc_id, filename)
            record.status = "parse_failed"
            await db.commit()
            await db.refresh(record)
            results.append(UploadResult(
                filename=filename,
                success=False,
                record=InvoiceRecordRead.model_validate(record),
                error="PDF appears to be scanned/image-only with no text layer.",
            ))
            continue

        # 4. Chunk + embed
        chunks = parser.chunk_text(text)
        vector_store.add_document(
            doc_id=doc_id,
            chunks=chunks,
            metadata={"filename": filename},
        )

        # 5. Extract metadata hints and finalize record
        hints = parser.extract_metadata_hints(text)
        record.invoice_number = hints.get("invoice_number")
        record.client_name = hints.get("client_name")
        record.issue_date = hints.get("issue_date")
        record.grand_total = hints.get("grand_total")
        record.status = "indexed"

        await db.commit()
        await db.refresh(record)

        logger.info("Indexed %s (doc_id=%s) with %d chunks. Hints: %s", filename, doc_id, len(chunks), hints)
        results.append(UploadResult(
            filename=filename,
            success=True,
            record=InvoiceRecordRead.model_validate(record),
        ))

    succeeded = sum(1 for r in results if r.success)
    return BulkUploadResponse(
        results=results,
        total=len(results),
        succeeded=succeeded,
        failed=len(results) - succeeded,
    )


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


@router.post("/generate", response_model=GenerateInvoiceResponse)
async def generate_invoice(
    request: Request,
    body: GenerateInvoiceRequest,
    db: AsyncSession = Depends(get_db),
) -> GenerateInvoiceResponse:
    """
    Generate a new invoice draft from a plain-text prompt.

    Uses RAG to pull relevant context from previously uploaded invoices,
    then calls OpenAI gpt-4o-mini to produce a structured invoice JSON.
    """
    # 1. Determine next invoice number from the DB
    result = await db.execute(select(func.count()).select_from(InvoiceRecord))
    total = result.scalar_one()
    year = date.today().year
    next_number = f"INV-{year}-{total + 1:04d}"

    # 2. Load business settings (may be empty on first use)
    settings_result = await db.execute(select(BusinessSettings).where(BusinessSettings.id == 1))
    settings_row = settings_result.scalar_one_or_none()
    business_profile: dict = {}
    if settings_row:
        business_profile = {
            "name": settings_row.name,
            "address": settings_row.address,
            "email": settings_row.email,
            "phone": settings_row.phone,
            "tax_id": settings_row.tax_id,
            "default_currency": settings_row.default_currency,
            "default_tax_pct": settings_row.default_tax_pct,
            "payment_terms": settings_row.payment_terms,
            "bank_name": settings_row.bank_name,
            "account_name": settings_row.account_name,
            "account_number": settings_row.account_number,
            "routing_number": settings_row.routing_number,
            "payment_notes": settings_row.payment_notes,
        }

    # 3. Retrieve RAG context
    vector_store = request.app.state.vector_store
    rag_svc = RAGService(vector_store)
    rag_context, docs_used = rag_svc.get_context(body.prompt)

    # 4. Call OpenAI
    try:
        invoice_data = openai_svc.generate_invoice(
            prompt=body.prompt,
            business_profile=business_profile,
            rag_context=rag_context,
            next_invoice_number=next_number,
        )
    except ValueError as exc:
        logger.error("Invoice generation failed: %s", exc)
        raise HTTPException(422, detail=str(exc))

    logger.info("Generated invoice %s using %d RAG docs.", next_number, docs_used)
    return GenerateInvoiceResponse(invoice=invoice_data, rag_docs_used=docs_used)
