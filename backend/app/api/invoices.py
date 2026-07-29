import hashlib
import io
import json
import logging
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.billing import require_pro_entitlement
from app.auth import AuthenticatedUser, get_current_user
from app.config import settings
from app.database import get_db
from app.models.db_models import BusinessSettings, CatalogItem, Client, InvoiceEmail, InvoiceRecord
from app.models.schemas import (
    BulkUploadResponse,
    GenerateInvoiceRequest,
    GenerateInvoiceResponse,
    InvoiceData,
    InvoiceEmailAttemptRead,
    InvoiceEmailRead,
    InvoiceRecordRead,
    NextInvoiceNumberResponse,
    ReconcileInvoiceEmailRequest,
    SendInvoiceRequest,
    SendInvoiceResponse,
    UploadResult,
)
from app.services.email_service import EmailService
from app.services.invoice_numbering import (
    ensure_client_code,
    format_invoice_number,
    next_client_invoice_sequence,
)
from app.services.openai_service import OpenAIService
from app.services.pdf_generator import PDFGeneratorService
from app.services.pdf_parser import PDFParserService
from app.services.rag_service import RAGService
from app.services.storage import StorageService
from app.security import enforce_rate_limit

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/invoices", tags=["invoices"])

storage = StorageService()
parser = PDFParserService()
openai_svc = OpenAIService()
pdf_gen = PDFGeneratorService()
email_svc = EmailService()


async def _get_owned_client(
    db: AsyncSession,
    user_id: str,
    client_id: int,
) -> Client | None:
    result = await db.execute(
        select(Client)
        .options(selectinload(Client.addresses))
        .where(Client.id == client_id, Client.user_id == user_id)
    )
    client = result.scalar_one_or_none()
    if client:
        had_code = bool(client.client_code)
        await ensure_client_code(db, client)
        if not had_code:
            await db.commit()
    return client


async def _next_invoice_preview(
    db: AsyncSession,
    user_id: str,
    client_id: int,
) -> NextInvoiceNumberResponse:
    client = await _get_owned_client(db, user_id, client_id)
    if not client or not client.client_code:
        raise HTTPException(404, "Client not found.")

    sequence = await next_client_invoice_sequence(db, user_id, client.id)
    return NextInvoiceNumberResponse(
        client_id=client.id,
        client_code=client.client_code,
        client_invoice_sequence=sequence,
        invoice_number=format_invoice_number(client.client_code, sequence),
    )


async def _business_settings(db: AsyncSession, user_id: str) -> BusinessSettings | None:
    settings_result = await db.execute(select(BusinessSettings).where(BusinessSettings.user_id == user_id))
    return settings_result.scalar_one_or_none()


async def _get_owned_invoice_record(
    db: AsyncSession,
    user_id: str,
    record_id: int,
) -> InvoiceRecord:
    result = await db.execute(
        select(InvoiceRecord).where(InvoiceRecord.id == record_id, InvoiceRecord.user_id == user_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(404, "Invoice record not found.")
    return record


async def _load_record_pdf_bytes(record: InvoiceRecord) -> bytes:
    if record.storage_path:
        return await storage.supabase.download_bytes(record.storage_path)

    path = Path(record.file_path)
    if not path.exists():
        raise HTTPException(404, "PDF file not found on disk.")
    return path.read_bytes()


@router.post("/upload", response_model=BulkUploadResponse)
async def upload_invoices(
    request: Request,
    files: Annotated[list[UploadFile], File(description="One or more invoice PDFs to upload")],
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BulkUploadResponse:
    """
    Upload one or more historical invoice PDFs.
    Each file is parsed, chunked, embedded into Supabase pgvector, and recorded in the DB.
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
            logger.warning("upload_rejected_non_pdf")
            continue

        # 1. Save file to disk
        try:
            doc_id, file_path, contents, storage_path = await storage.save_uploaded_pdf(file, current_user.id)
        except ValueError as e:
            results.append(UploadResult(filename=filename, success=False, error=str(e)))
            logger.warning("upload_save_failed", extra={"exception_type": type(e).__name__})
            continue

        # 2. Insert a record with status='processing'
        record = InvoiceRecord(
            user_id=current_user.id,
            filename=filename,
            file_path=str(file_path),
            storage_path=storage_path,
            source="uploaded",
            rag_doc_id=doc_id,
            status="processing",
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)

        # 3. Extract text
        text, is_low_quality = parser.extract_text(contents)

        if is_low_quality:
            logger.warning("upload_low_quality_pdf")
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
        await vector_store.add_document(
            db,
            doc_id=doc_id,
            user_id=current_user.id,
            invoice_record_id=record.id,
            filename=filename,
            chunks=chunks,
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

        logger.info("upload_indexed")
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
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[InvoiceRecordRead]:
    """Return all invoice records ordered by most recently added."""
    result = await db.execute(
        select(InvoiceRecord).where(InvoiceRecord.user_id == current_user.id).order_by(InvoiceRecord.created_at.desc())
    )
    records = result.scalars().all()
    return [InvoiceRecordRead.model_validate(r) for r in records]


@router.get("/draft", response_model=InvoiceData)
async def create_invoice_draft(
    client_id: int | None = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> InvoiceData:
    """Return a fresh invoice draft without invoking AI generation."""
    settings_row = await _business_settings(db, current_user.id)
    invoice_number = None
    if client_id is not None:
        preview = await _next_invoice_preview(db, current_user.id, client_id)
        invoice_number = preview.invoice_number
    return InvoiceData.model_validate({
        "invoice_number": invoice_number,
        "issue_date": date.today().isoformat(),
        "status": "draft",
        "from": {
            "name": settings_row.name if settings_row else None,
            "address": settings_row.address if settings_row else None,
            "email": settings_row.email if settings_row else None,
            "phone": settings_row.phone if settings_row else None,
            "logo_path": settings_row.logo_path if settings_row else None,
        },
        "to": {
            "client_id": None,
            "name": None,
            "address": None,
            "email": None,
            "phone": None,
        },
        "line_items": [
            {"description": "", "quantity": 1, "unit": "item", "unit_price": 0, "subtotal": 0}
        ],
        "totals": {"subtotal": 0, "grand_total": 0},
        "notes": None,
    })


@router.get("/next-number", response_model=NextInvoiceNumberResponse)
async def get_next_invoice_number(
    client_id: int,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NextInvoiceNumberResponse:
    return await _next_invoice_preview(db, current_user.id, client_id)


@router.get("/{record_id}/pdf")
async def view_invoice_pdf(
    record_id: int,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Return the stored PDF for a given invoice record (inline, for browser preview)."""
    record = await _get_owned_invoice_record(db, current_user.id, record_id)
    pdf_bytes = await _load_record_pdf_bytes(record)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{record.filename}"'},
    )


@router.get("/{record_id}/download")
async def download_invoice_pdf(
    record_id: int,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    record = await _get_owned_invoice_record(db, current_user.id, record_id)
    pdf_bytes = await _load_record_pdf_bytes(record)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{record.filename}"'},
    )


@router.post("/generate", response_model=GenerateInvoiceResponse)
async def generate_invoice(
    request: Request,
    body: GenerateInvoiceRequest,
    current_user: AuthenticatedUser = Depends(require_pro_entitlement),
    db: AsyncSession = Depends(get_db),
) -> GenerateInvoiceResponse:
    """
    Generate a new invoice draft from a plain-text prompt.

    Uses RAG to pull relevant context from previously uploaded invoices,
    then calls OpenAI gpt-4o-mini to produce a structured invoice JSON.
    """
    await enforce_rate_limit(
        db,
        user_id=current_user.id,
        event_type="invoice.generate",
        limit=settings.invoice_generation_limit,
        window_seconds=settings.invoice_generation_window_seconds,
        request_id=getattr(request.state, "request_id", None),
    )
    # 1. Determine next invoice number from the DB
    # 2. Load business settings (may be empty on first use)
    settings_row = await _business_settings(db, current_user.id)
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
        select(Client).options(selectinload(Client.addresses)).where(Client.user_id == current_user.id).order_by(Client.name)
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

    # 4. Load catalog items for reusable line item context
    catalog_result = await db.execute(select(CatalogItem).where(CatalogItem.user_id == current_user.id).order_by(CatalogItem.description))
    catalog_context = [
        {
            "id": item.id,
            "description": item.description,
            "unit": item.unit,
            "unit_price": item.unit_price,
            "notes": item.notes,
        }
        for item in catalog_result.scalars().all()
    ]

    # 5. Retrieve RAG context
    vector_store = request.app.state.vector_store
    rag_svc = RAGService(vector_store)
    rag_context, docs_used = await rag_svc.get_context(db, body.prompt, current_user.id)

    # 6. Call OpenAI
    try:
        invoice_data = openai_svc.generate_invoice(
            prompt=body.prompt,
            business_profile=business_profile,
            rag_context=rag_context,
            next_invoice_number="assigned-after-client-selection",
            client_context=client_context,
            catalog_context=catalog_context,
        )
    except ValueError as exc:
        logger.error("invoice_generation_failed", extra={"exception_type": type(exc).__name__})
        raise HTTPException(422, detail="A valid invoice could not be generated from that prompt.")

    if invoice_data.to.client_id is not None:
        client = await _get_owned_client(db, current_user.id, invoice_data.to.client_id)
        if client and client.client_code:
            preview = await _next_invoice_preview(db, current_user.id, client.id)
            invoice_data.invoice_number = preview.invoice_number
            invoice_data.to.name = client.name
            invoice_data.to.email = client.email
            invoice_data.to.phone = client.phone
            if len(client.addresses) == 1 and not invoice_data.to.address:
                invoice_data.to.address = client.addresses[0].address
        else:
            invoice_data.to.client_id = None
            invoice_data.invoice_number = None
    else:
        invoice_data.invoice_number = None

    logger.info("invoice_draft_generated")
    return GenerateInvoiceResponse(invoice=invoice_data, rag_docs_used=docs_used)


async def _persist_invoice(
    db: AsyncSession,
    user: AuthenticatedUser,
    invoice: InvoiceData,
) -> tuple[InvoiceRecord, bytes]:
    """Validate, number, render, store and upsert an invoice.

    Shared by ``/export`` (streams the PDF) and ``/save`` (returns the record as
    JSON) so the persistence logic lives in exactly one place. Returns the
    committed, refreshed record and the rendered PDF bytes.
    """
    if invoice.to.client_id is None:
        raise HTTPException(422, detail="Select a saved client before exporting so the invoice can receive a per-client number.")

    client = await _get_owned_client(db, user.id, invoice.to.client_id)
    if not client or not client.client_code:
        raise HTTPException(422, detail="Selected client was not found.")

    existing = None
    if invoice.invoice_number:
        res = await db.execute(
            select(InvoiceRecord).where(
                InvoiceRecord.invoice_number == invoice.invoice_number,
                InvoiceRecord.user_id == user.id,
            )
        )
        existing = res.scalar_one_or_none()

    # An invoice number may only identify an update within the same client.
    # Treat a number copied from another client as a new invoice so one saved
    # record cannot be silently moved/clobbered by a crafted payload.
    if existing and existing.client_id != client.id:
        existing = None

    if existing and existing.client_id == client.id and existing.client_invoice_sequence:
        client_sequence = existing.client_invoice_sequence
    else:
        client_sequence = await next_client_invoice_sequence(db, user.id, client.id)

    invoice.invoice_number = format_invoice_number(client.client_code, client_sequence)
    invoice.to.client_id = client.id
    invoice.to.name = client.name
    invoice.to.email = client.email
    invoice.to.phone = client.phone

    # 1. Authoritative total recalculation
    invoice = pdf_gen.recalculate_totals(invoice)

    # 2. Load logo path from settings (if configured)
    settings_result = await db.execute(select(BusinessSettings).where(BusinessSettings.user_id == user.id))
    settings_row = settings_result.scalar_one_or_none()
    logo_path = settings_row.logo_path if settings_row else None

    # 3. Render PDF
    try:
        pdf_bytes = pdf_gen.render_pdf(invoice, logo_path=logo_path)
    except Exception as exc:
        logger.error("pdf_render_failed", extra={"exception_type": type(exc).__name__})
        raise HTTPException(500, detail="PDF rendering failed.")

    # 4. Build filename and save to disk
    inv_num = (invoice.invoice_number or "invoice").replace("/", "-").replace(" ", "_")
    filename = f"{inv_num}.pdf"
    pdf_path, storage_path = await storage.save_generated_pdf(user.id, inv_num, pdf_bytes)
    logger.info("invoice_pdf_saved")

    # 5. Upsert invoice_records: update if invoice_number exists, else create
    invoice_json_str = json.dumps(invoice.model_dump(by_alias=True))

    if existing:
        existing.client_id = client.id
        existing.client_invoice_sequence = client_sequence
        existing.file_path = str(pdf_path)
        existing.storage_path = storage_path
        existing.filename = filename
        existing.client_name = invoice.to.name
        existing.issue_date = invoice.issue_date
        existing.grand_total = invoice.totals.grand_total
        existing.currency = "USD"
        existing.status = "exported"
        existing.invoice_json = invoice_json_str
        record = existing
    else:
        record = InvoiceRecord(
            user_id=user.id,
            client_id=client.id,
            client_invoice_sequence=client_sequence,
            filename=filename,
            file_path=str(pdf_path),
            storage_path=storage_path,
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
    await db.refresh(record)
    return record, pdf_bytes


@router.post("/export")
async def export_invoice(
    body: InvoiceData,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """
    Accept an InvoiceData payload, recalculate totals server-side, render to PDF,
    save to disk, upsert the invoice_records row, and return the PDF as a download.
    """
    record, pdf_bytes = await _persist_invoice(db, current_user, body)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{record.filename}"'},
    )


@router.post("/save", response_model=InvoiceRecordRead)
async def save_invoice(
    body: InvoiceData,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> InvoiceRecordRead:
    """
    Persist an invoice the same way ``/export`` does, but return the saved
    record as JSON (no forced download) so the editor can open the email modal
    for the just-saved invoice.
    """
    record, _ = await _persist_invoice(db, current_user, body)
    return InvoiceRecordRead.model_validate(record)


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
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> InvoiceRecordRead:
    """
    Add (or re-index) an exported invoice into the Supabase vector store.
    Uses the stored invoice JSON instead of re-parsing the PDF.
    """
    res = await db.execute(select(InvoiceRecord).where(InvoiceRecord.id == record_id, InvoiceRecord.user_id == current_user.id))
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
    if record.rag_doc_id:
        await vector_store.delete_document(db, doc_id=record.rag_doc_id, user_id=current_user.id)
        logger.info("vector_document_removed")

    doc_id = str(uuid.uuid4())
    chunks = parser.chunk_text(text)
    await vector_store.add_document(
        db,
        doc_id=doc_id,
        user_id=current_user.id,
        invoice_record_id=record.id,
        filename=record.filename,
        chunks=chunks,
    )

    record.rag_doc_id = doc_id
    await db.commit()
    await db.refresh(record)

    logger.info("invoice_document_indexed")
    return InvoiceRecordRead.model_validate(record)


@router.delete("/{record_id}", status_code=204)
async def delete_invoice(
    record_id: int,
    request: Request,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete an invoice record, its PDF file, and any stored vector chunks."""
    res = await db.execute(select(InvoiceRecord).where(InvoiceRecord.id == record_id, InvoiceRecord.user_id == current_user.id))
    record = res.scalar_one_or_none()
    if not record:
        raise HTTPException(404, "Invoice record not found.")

    # Remove vectors from Supabase if indexed
    if record.rag_doc_id:
        vector_store = request.app.state.vector_store
        await vector_store.delete_document(db, doc_id=record.rag_doc_id, user_id=current_user.id)
        logger.info("Removed vectors for doc_id=%s", record.rag_doc_id)

    # Delete the PDF file from disk (best-effort)
    pdf_path = Path(record.file_path)
    if pdf_path.exists():
        pdf_path.unlink()
        logger.info("invoice_pdf_deleted")

    await db.delete(record)
    await db.commit()
    logger.info("Deleted invoice record id=%d", record_id)


@router.get("/{record_id}/emails", response_model=list[InvoiceEmailRead])
async def list_invoice_emails(
    record_id: int,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[InvoiceEmailRead]:
    await _get_owned_invoice_record(db, current_user.id, record_id)
    result = await db.execute(
        select(InvoiceEmail)
        .where(
            InvoiceEmail.invoice_record_id == record_id,
            InvoiceEmail.user_id == current_user.id,
            InvoiceEmail.status == "sent",
        )
        .order_by(InvoiceEmail.created_at.desc())
    )
    return [InvoiceEmailRead.model_validate(email) for email in result.scalars().all()]


@router.get(
    "/{record_id}/email-attempts/pending",
    response_model=list[InvoiceEmailAttemptRead],
)
async def list_pending_email_attempts(
    record_id: int,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[InvoiceEmailAttemptRead]:
    await _get_owned_invoice_record(db, current_user.id, record_id)
    result = await db.execute(
        select(InvoiceEmail)
        .where(
            InvoiceEmail.invoice_record_id == record_id,
            InvoiceEmail.user_id == current_user.id,
            InvoiceEmail.status == "pending",
        )
        .order_by(InvoiceEmail.created_at.desc())
    )
    return [
        InvoiceEmailAttemptRead.model_validate(email)
        for email in result.scalars().all()
    ]


@router.post(
    "/{record_id}/email-attempts/{email_id}/reconcile",
    response_model=InvoiceEmailRead,
)
async def reconcile_email_attempt(
    record_id: int,
    email_id: int,
    body: ReconcileInvoiceEmailRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> InvoiceEmailRead:
    await _get_owned_invoice_record(db, current_user.id, record_id)
    result = await db.execute(
        select(InvoiceEmail)
        .where(
            InvoiceEmail.id == email_id,
            InvoiceEmail.invoice_record_id == record_id,
            InvoiceEmail.user_id == current_user.id,
        )
        .with_for_update()
    )
    email = result.scalar_one_or_none()
    if not email:
        raise HTTPException(404, "Email attempt not found.")
    if email.status != "pending":
        raise HTTPException(409, "Only pending email attempts can be reconciled.")
    now = datetime.now(UTC)
    if email.lease_expires_at and email.lease_expires_at > now:
        raise HTTPException(409, "This email attempt lease is still active.")

    email.lease_expires_at = None
    if body.resolution == "delivered":
        email.status = "sent"
        email.sent_at = now
        email.error_message = None
    else:
        email.status = "failed"
        email.error_message = "Owner reconciled stale attempt as not delivered."
    await db.commit()
    await db.refresh(email)
    logger.info("email_attempt_reconciled")
    return InvoiceEmailRead.model_validate(email)


@router.post("/{record_id}/send", response_model=SendInvoiceResponse)
async def send_invoice(
    record_id: int,
    request: Request,
    body: SendInvoiceRequest,
    current_user: AuthenticatedUser = Depends(require_pro_entitlement),
    db: AsyncSession = Depends(get_db),
) -> SendInvoiceResponse:
    record = await _get_owned_invoice_record(db, current_user.id, record_id)
    if record.status != "exported":
        raise HTTPException(422, "Only exported invoices can be emailed.")
    if not record.invoice_json:
        raise HTTPException(422, "This invoice does not have saved invoice data for email sending.")

    try:
        invoice = InvoiceData.model_validate(json.loads(record.invoice_json))
    except Exception as exc:
        raise HTTPException(422, f"Could not read saved invoice data: {exc}") from exc

    recipient_email = (
        body.recipient_email
        if "recipient_email" in body.model_fields_set
        else (invoice.to.email or "").strip()
    )
    if not recipient_email:
        raise HTTPException(422, "Recipient email is required before sending.")

    business_name = (
        body.from_display_name
        or (invoice.from_.name or "").strip()
        or "Invoice Assistant"
    )
    reply_to_email = (
        body.reply_to_email
        if "reply_to_email" in body.model_fields_set
        else (
            (invoice.from_.email or "").strip()
            or (current_user.email or "").strip()
            or None
        )
    )
    cc_email = (
        body.cc_email
        if "cc_email" in body.model_fields_set
        else (current_user.email.strip() if current_user.email else None)
    )
    pdf_bytes = await _load_record_pdf_bytes(record)
    fingerprint_payload = {
        "record_id": record.id,
        "recipient_email": recipient_email,
        "cc_email": cc_email,
        "reply_to_email": reply_to_email,
        "from_display_name": business_name,
        "subject": body.subject.strip(),
        "message": body.message.strip(),
        "pdf_sha256": hashlib.sha256(pdf_bytes).hexdigest(),
    }
    request_fingerprint = hashlib.sha256(
        json.dumps(fingerprint_payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()

    if body.idempotency_key:
        replay_result = await db.execute(
            select(InvoiceEmail).where(
                InvoiceEmail.user_id == current_user.id,
                InvoiceEmail.idempotency_key == body.idempotency_key,
            )
        )
        replay = replay_result.scalar_one_or_none()
        if replay:
            if replay.request_fingerprint != request_fingerprint:
                raise HTTPException(
                    409,
                    "This idempotency key is already bound to different email content.",
                )
            if replay.status == "sent":
                return SendInvoiceResponse(email=InvoiceEmailRead.model_validate(replay))

    await enforce_rate_limit(
        db,
        user_id=current_user.id,
        event_type="invoice.email_send",
        limit=settings.email_send_limit,
        window_seconds=settings.email_send_window_seconds,
        request_id=getattr(request.state, "request_id", None),
    )

    email_record: InvoiceEmail | None = None
    lock_key = (
        f"{current_user.id}:{body.idempotency_key}"
        if body.idempotency_key
        else None
    )
    if lock_key:
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": lock_key},
        )
        existing_result = await db.execute(
            select(InvoiceEmail).where(
                InvoiceEmail.user_id == current_user.id,
                InvoiceEmail.idempotency_key == body.idempotency_key,
            )
        )
        email_record = existing_result.scalar_one_or_none()
        if email_record:
            if email_record.request_fingerprint != request_fingerprint:
                raise HTTPException(
                    409,
                    "This idempotency key is already bound to different email content.",
                )
            if email_record.status == "sent":
                return SendInvoiceResponse(
                    email=InvoiceEmailRead.model_validate(email_record)
                )
            if email_record.status == "pending":
                now = datetime.now(UTC)
                if email_record.lease_expires_at and email_record.lease_expires_at > now:
                    retry_after = max(
                        1, int((email_record.lease_expires_at - now).total_seconds())
                    )
                    raise HTTPException(
                        409,
                        "An email send with this idempotency key is already in progress.",
                        headers={"Retry-After": str(retry_after)},
                    )
                raise HTTPException(
                    409,
                    (
                        "This email attempt has an expired, ambiguous delivery state. "
                        f"Reconcile email attempt {email_record.id} before retrying."
                    ),
                )

    if email_record is None:
        email_record = InvoiceEmail(
            user_id=current_user.id,
            invoice_record_id=record.id,
            recipient_email=recipient_email,
            cc_email=cc_email,
            subject=body.subject.strip(),
            message_body=body.message.strip(),
            status="pending",
            provider=email_svc.provider,
            idempotency_key=body.idempotency_key,
            request_fingerprint=request_fingerprint,
            attempt_count=1,
            attempt_token=str(uuid.uuid4()),
            lease_expires_at=datetime.now(UTC)
            + timedelta(seconds=settings.email_send_lease_seconds),
            provider_message_id=(
                email_svc.message_id_for_key(lock_key)
                if lock_key
                else None
            ),
        )
        db.add(email_record)
    else:
        email_record.status = "pending"
        email_record.error_message = None
        email_record.attempt_count += 1
        email_record.attempt_token = str(uuid.uuid4())
        email_record.lease_expires_at = datetime.now(UTC) + timedelta(
            seconds=settings.email_send_lease_seconds
        )

    await db.commit()
    await db.refresh(email_record)
    attempt_token = email_record.attempt_token

    try:
        provider_message_id = await email_svc.send_invoice_email(
            recipient_email=recipient_email,
            cc_email=cc_email,
            reply_to_email=reply_to_email,
            from_display_name=business_name,
            subject=email_record.subject,
            message=email_record.message_body,
            attachment_filename=record.filename,
            attachment_bytes=pdf_bytes,
            message_id=email_record.provider_message_id,
        )
    except Exception as exc:
        finalized = await db.execute(
            update(InvoiceEmail)
            .where(
                InvoiceEmail.id == email_record.id,
                InvoiceEmail.status == "pending",
                InvoiceEmail.attempt_token == attempt_token,
            )
            .values(
                status="failed",
                lease_expires_at=None,
                error_message=f"{type(exc).__name__}: provider send failed",
            )
        )
        await db.commit()
        if finalized.rowcount != 1:
            raise HTTPException(
                409,
                "This email attempt was superseded; inspect its current state before retrying.",
            ) from exc
        await db.refresh(email_record)
        logger.error(
            "email_send_failed",
            extra={"exception_type": type(exc).__name__},
        )
        raise HTTPException(
            502, "Email send failed. Retry later using the same send attempt."
        ) from exc

    finalized = await db.execute(
        update(InvoiceEmail)
        .where(
            InvoiceEmail.id == email_record.id,
            InvoiceEmail.status == "pending",
            InvoiceEmail.attempt_token == attempt_token,
        )
        .values(
            status="sent",
            provider_message_id=provider_message_id,
            error_message=None,
            lease_expires_at=None,
            sent_at=datetime.now(UTC),
        )
    )
    await db.commit()
    if finalized.rowcount != 1:
        raise HTTPException(
            409,
            "This email attempt was superseded; inspect its current state before retrying.",
        )
    await db.refresh(email_record)

    logger.info("email_sent")
    return SendInvoiceResponse(email=InvoiceEmailRead.model_validate(email_record))
