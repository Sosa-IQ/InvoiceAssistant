import uuid
from pathlib import Path

from fastapi import UploadFile

from app.config import settings


class StorageService:
    """Handles saving and retrieving PDF files on local disk."""

    def get_invoices_dir(self) -> Path:
        settings.invoices_dir.mkdir(parents=True, exist_ok=True)
        return settings.invoices_dir

    async def save_uploaded_pdf(self, file: UploadFile) -> tuple[str, Path, bytes]:
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
        file_path = self.get_invoices_dir() / filename

        file_path.write_bytes(contents)

        return doc_id, file_path, contents

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
