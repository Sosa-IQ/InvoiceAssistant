import io
import re
from pathlib import Path

import pdfplumber


class PDFParserService:
    """Extracts and chunks text from PDF files."""

    MIN_TEXT_LENGTH = 50  # below this we flag as low-quality/scanned

    def extract_text(self, source: Path | bytes) -> tuple[str, bool]:
        """
        Extract all text from a PDF.

        Args:
            source: Path to PDF file, or raw bytes.

        Returns:
            (text, is_low_quality)
            is_low_quality=True means the PDF appears to be a scan with no text layer.
        """
        if isinstance(source, bytes):
            pdf_file = io.BytesIO(source)
        else:
            pdf_file = source

        pages: list[str] = []
        with pdfplumber.open(pdf_file) as pdf:
            for i, page in enumerate(pdf.pages, start=1):
                page_text = page.extract_text() or ""
                pages.append(f"--- PAGE {i} ---\n{page_text}")

        full_text = "\n\n".join(pages)
        is_low_quality = len(full_text.strip()) < self.MIN_TEXT_LENGTH

        return full_text, is_low_quality

    def chunk_text(
        self,
        text: str,
        chunk_size: int = 2000,
        overlap: int = 200,
    ) -> list[str]:
        """
        Split text into overlapping chunks for embedding.

        Args:
            text: Full document text.
            chunk_size: Max characters per chunk.
            overlap: Characters of overlap between consecutive chunks.

        Returns:
            List of text chunks (non-empty).
        """
        if not text.strip():
            return []

        chunks: list[str] = []
        start = 0

        while start < len(text):
            end = start + chunk_size
            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)
            start += chunk_size - overlap

        return chunks

    def extract_metadata_hints(self, text: str) -> dict:
        """
        Best-effort regex extraction of invoice metadata from raw text.
        Results are advisory — never relied upon for correctness.
        """
        hints: dict = {}

        # Invoice number patterns: INV-2024-001, Invoice #1234, etc.
        inv_match = re.search(
            r"(?:invoice\s*(?:no|number|#)[:\s]*)([\w\-]+)",
            text,
            re.IGNORECASE,
        )
        if inv_match:
            hints["invoice_number"] = inv_match.group(1).strip()

        # Date patterns: 2024-01-15, 01/15/2024, January 15, 2024
        date_match = re.search(
            r"\b(\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4})\b",
            text,
        )
        if date_match:
            hints["issue_date"] = date_match.group(1).strip()

        # Total amount: $1,234.56 or Total: 1234.56
        total_match = re.search(
            r"(?:grand\s*total|total\s*due|amount\s*due)[:\s]*\$?([\d,]+\.?\d*)",
            text,
            re.IGNORECASE,
        )
        if total_match:
            try:
                hints["grand_total"] = float(
                    total_match.group(1).replace(",", "")
                )
            except ValueError:
                pass

        return hints
