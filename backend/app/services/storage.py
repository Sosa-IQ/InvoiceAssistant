import uuid
from pathlib import Path

from fastapi import UploadFile

from app.config import settings
from app.services.supabase_service import SupabaseService


class StorageService:
    """Handles saving and retrieving PDF files on local disk."""

    def __init__(self, supabase: SupabaseService | None = None) -> None:
        self.supabase = supabase or SupabaseService()

    def get_invoices_dir(self) -> Path:
        settings.invoices_dir.mkdir(parents=True, exist_ok=True)
        return settings.invoices_dir

    def get_user_dir(self, user_id: str) -> Path:
        """Per-user cache folder, so tenants with the same invoice number never share a file."""
        # Supabase user ids are UUIDs; normalizing also rules out path traversal via the id.
        user_dir = self.get_invoices_dir() / str(uuid.UUID(user_id))
        user_dir.mkdir(parents=True, exist_ok=True)
        return user_dir

    def is_user_local_path(self, user_id: str, file_path: str | None) -> bool:
        """True only for files inside this user's cache folder.

        Records created before per-user folders point at the shared flat directory, where a
        same-named file may belong to another tenant, so those are never treated as owned.
        """
        if not file_path:
            return False
        user_dir = (settings.invoices_dir / str(uuid.UUID(user_id))).resolve()
        return Path(file_path).resolve().is_relative_to(user_dir)

    async def save_uploaded_pdf(self, file: UploadFile, user_id: str) -> tuple[str, Path, bytes, str | None]:
        """
        Save an uploaded PDF to disk.

        Returns:
            (doc_id, file_path, file_bytes)
        """
        contents = await file.read()

        if len(contents) > settings.max_upload_bytes:
            raise ValueError(
                f"File exceeds {settings.max_upload_size_mb}MB limit "
                f"({len(contents) / 1024 / 1024:.1f}MB uploaded)"
            )

        doc_id = str(uuid.uuid4())
        safe_name = Path(file.filename or "invoice.pdf").name
        filename = f"{doc_id}_{safe_name}"
        file_path = self.get_user_dir(user_id) / filename

        file_path.write_bytes(contents)

        storage_path = None
        if settings.supabase_url and settings.supabase_service_role_key:
            storage_path = f"{user_id}/{doc_id}/{filename}"
            await self.supabase.upload_bytes(storage_path, contents, "application/pdf")

        return doc_id, file_path, contents, storage_path

    async def save_generated_pdf(
        self,
        user_id: str,
        invoice_number: str,
        pdf_bytes: bytes,
    ) -> tuple[Path, str | None]:
        safe_number = invoice_number.replace("/", "-").replace(" ", "_")
        filename = f"{safe_number}.pdf"
        pdf_path = self.get_user_dir(user_id) / filename
        pdf_path.write_bytes(pdf_bytes)
        storage_path = None
        if settings.supabase_url and settings.supabase_service_role_key:
            storage_path = f"{user_id}/{safe_number}/{filename}"
            await self.supabase.upload_bytes(storage_path, pdf_bytes, "application/pdf")
        return pdf_path, storage_path

    def get_pdf_path(self, doc_id: str) -> Path | None:
        """Find a PDF on disk by its doc_id prefix."""
        for f in self.get_invoices_dir().iterdir():
            if f.name.startswith(doc_id) and f.suffix == ".pdf":
                return f
        return None

    def list_pdfs(self) -> list[Path]:
        """List all PDF files in the invoices directory."""
        return sorted(
            self.get_invoices_dir().glob("*.pdf"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
