import io
import json
import logging
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.db_models import BusinessSettings, Client, InvoiceRecord
from app.models.schemas import (
    BulkUploadResponse,
    GenerateInvoiceRequest,
    GenerateInvoiceResponse,
    InvoiceData,
    InvoiceRecordRead,
    UploadResult,
)
from app.services.openai_service import OpenAIService
from app.services.pdf_generator import PDFGeneratorService
from app.services.pdf_parser import PDFParserService
from app.services.rag_service import RAGService
from app.services.storage import StorageService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/invoices", tags=["invoices"])

storage = StorageService()
parser = PDFParserService()
openai_svc = OpenAIService()
pdf_gen = PDFGeneratorService()


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


@router.get("/{record_id}/pdf")
async def view_invoice_pdf(
    record_id: int,
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    """Return the stored PDF for a given invoice record (inline, for browser preview)."""
    result = await db.execute(select(InvoiceRecord).where(InvoiceRecord.id == record_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(404, "Invoice record not found.")
    path = Path(record.file_path)
    if not path.exists():
        raise HTTPException(404, "PDF file not found on disk.")
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{record.filename}"'},
    )


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
    next_number = f"Invoice-#{total + 1}"

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

    # 3. Load all clients with their addresses for context injection
    clients_result = await db.execute(
        select(Client).options(selectinload(Client.addresses)).order_by(Client.name)
    )
    client_context = [
        {
            "id": c.id,
            "name": c.name,
            "email": c.email,
            "phone": c.phone,
            "addresses": [
                {"id": a.id, "label": a.label, "address": a.address}
                for a in c.addresses
            ],
        }
        for c in clients_result.scalars().all()
    ]

    # 4. Retrieve RAG context
    vector_store = request.app.state.vector_store
    rag_svc = RAGService(vector_store)
    rag_context, docs_used = rag_svc.get_context(body.prompt)

    # 5. Call OpenAI
    try:
        invoice_data = openai_svc.generate_invoice(
            prompt=body.prompt,
            business_profile=business_profile,
            rag_context=rag_context,
            next_invoice_number=next_number,
            client_context=client_context,
        )
    except ValueError as exc:
        logger.error("Invoice generation failed: %s", exc)
        raise HTTPException(422, detail=str(exc))

    logger.info("Generated invoice %s using %d RAG docs.", next_number, docs_used)
    return GenerateInvoiceResponse(invoice=invoice_data, rag_docs_used=docs_used)


@router.post("/export")
async def export_invoice(
    body: InvoiceData,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """
    Accept an InvoiceData payload, recalculate totals server-side, render to PDF,
    save to disk, upsert the invoice_records row, and return the PDF as a download.
    """
    # 1. Authoritative total recalculation
    invoice = pdf_gen.recalculate_totals(body)

    # 2. Load logo path from settings (if configured)
    settings_result = await db.execute(select(BusinessSettings).where(BusinessSettings.id == 1))
    settings_row = settings_result.scalar_one_or_none()
    logo_path = settings_row.logo_path if settings_row else None

    # 3. Render PDF
    try:
        pdf_bytes = pdf_gen.render_pdf(invoice, logo_path=logo_path)
    except Exception as exc:
        logger.error("PDF rendering failed: %s", exc, exc_info=True)
        raise HTTPException(500, detail=f"PDF rendering failed: {exc}")

    # 4. Build filename and save to disk
    inv_num = (invoice.invoice_number or "invoice").replace("/", "-").replace(" ", "_")
    filename = f"{inv_num}.pdf"
    invoices_dir = storage.get_invoices_dir()
    pdf_path = invoices_dir / filename
    pdf_path.write_bytes(pdf_bytes)
    logger.info("Exported PDF saved to %s", pdf_path)

    # 5. Upsert invoice_records: update if invoice_number exists, else create
    invoice_json_str = json.dumps(invoice.model_dump(by_alias=True))

    existing = None
    if invoice.invoice_number:
        res = await db.execute(
            select(InvoiceRecord).where(InvoiceRecord.invoice_number == invoice.invoice_number)
        )
        existing = res.scalar_one_or_none()

    if existing:
        existing.file_path = str(pdf_path)
        existing.filename = filename
        existing.client_name = invoice.to.name
        existing.issue_date = invoice.issue_date
        existing.grand_total = invoice.totals.grand_total
        existing.currency = "USD"
        existing.status = "exported"
        existing.invoice_json = invoice_json_str
        await db.commit()
    else:
        record = InvoiceRecord(
            filename=filename,
            file_path=str(pdf_path),
            source="generated",
            invoice_number=invoice.invoice_number,
            client_name=invoice.to.name,
            issue_date=invoice.issue_date,
            grand_total=invoice.totals.grand_total,
            currency="USD",
            status="exported",
            invoice_json=invoice_json_str,
        )
        db.add(record)
        await db.commit()

    # 6. Stream the PDF back
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _invoice_to_text(invoice: InvoiceData) -> str:
    """Convert structured InvoiceData to a human-readable text for RAG indexing."""
    lines: list[str] = []

    if invoice.invoice_number:
        lines.append(f"Invoice: {invoice.invoice_number}")
    if invoice.issue_date:
        lines.append(f"Date: {invoice.issue_date}")

    fr = invoice.from_
    from_parts = [p for p in [fr.name, fr.address, fr.email, fr.phone] if p]
    if from_parts:
        lines.append(f"From: {' | '.join(from_parts)}")

    to = invoice.to
    to_parts = [p for p in [to.name, to.address, to.email, to.phone] if p]
    if to_parts:
        lines.append(f"Bill To: {' | '.join(to_parts)}")

    if invoice.line_items:
        lines.append("\nLine Items:")
        for item in invoice.line_items:
            lines.append(
                f"  - {item.description}: {item.quantity} {item.unit} "
                f"× ${item.unit_price:.2f} = ${item.subtotal:.2f}"
            )

    lines.append(f"\nTotal: ${invoice.totals.grand_total:.2f}")

    if invoice.notes:
        lines.append(f"\nNotes: {invoice.notes}")

    return "\n".join(lines)


@router.post("/{record_id}/index", response_model=InvoiceRecordRead)
async def index_invoice(
    record_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> InvoiceRecordRead:
    """
    Add (or re-index) an exported invoice into the RAG vector store.
    Uses the stored invoice JSON instead of re-parsing the PDF.
    """
    res = await db.execute(select(InvoiceRecord).where(InvoiceRecord.id == record_id))
    record = res.scalar_one_or_none()
    if not record:
        raise HTTPException(404, "Invoice record not found.")
    if not record.invoice_json:
        raise HTTPException(422, "No invoice data available for this record. Re-export the invoice to enable indexing.")

    # Parse the stored JSON back into InvoiceData
    invoice = InvoiceData.model_validate(json.loads(record.invoice_json))
    text = _invoice_to_text(invoice)

    vector_store = request.app.state.vector_store

    # Remove old vectors if previously indexed
    if record.chroma_doc_id:
        vector_store.delete_document(record.chroma_doc_id)
        logger.info("Removed old vectors for record id=%d (doc_id=%s)", record_id, record.chroma_doc_id)

    doc_id = str(uuid.uuid4())
    chunks = parser.chunk_text(text)
    vector_store.add_document(doc_id, chunks, {"filename": record.filename})

    record.chroma_doc_id = doc_id
    await db.commit()
    await db.refresh(record)

    logger.info("Indexed generated invoice record id=%d as doc_id=%s (%d chunks)", record_id, doc_id, len(chunks))
    return InvoiceRecordRead.model_validate(record)


@router.delete("/{record_id}", status_code=204)
async def delete_invoice(
    record_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete an invoice record, its PDF file, and any ChromaDB vectors."""
    res = await db.execute(select(InvoiceRecord).where(InvoiceRecord.id == record_id))
    record = res.scalar_one_or_none()
    if not record:
        raise HTTPException(404, "Invoice record not found.")

    # Remove vectors from ChromaDB if indexed
    if record.chroma_doc_id:
        vector_store = request.app.state.vector_store
        vector_store.delete_document(record.chroma_doc_id)
        logger.info("Removed vectors for doc_id=%s", record.chroma_doc_id)

    # Delete the PDF file from disk (best-effort)
    pdf_path = Path(record.file_path)
    if pdf_path.exists():
        pdf_path.unlink()
        logger.info("Deleted PDF file %s", pdf_path)

    await db.delete(record)
    await db.commit()
    logger.info("Deleted invoice record id=%d", record_id)
