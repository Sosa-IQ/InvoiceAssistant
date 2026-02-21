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

        # Invoice number: "Invoice #1", "# 1", "INV-2024-001", "Invoice No: 42"
        inv_match = re.search(
            r"(?:invoice\s*(?:no\.?|number|#)[:\s]*|(?:^|\s)#\s*)([A-Z0-9][\w\-]*)",
            text,
            re.IGNORECASE | re.MULTILINE,
        )
        if inv_match:
            hints["invoice_number"] = inv_match.group(1).strip()

        # Date: 2024-01-15, 01/15/2024, Feb 12 2026, February 12, 2026
        date_match = re.search(
            r"\b("
            r"\d{4}-\d{2}-\d{2}"
            r"|\d{1,2}/\d{1,2}/\d{4}"
            r"|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}"
            r")\b",
            text,
            re.IGNORECASE,
        )
        if date_match:
            hints["issue_date"] = date_match.group(1).strip()

        # Client name: prefer the next line after "Bill To:" (handles side-by-side layouts),
        # fall back to same-line text if the next line isn't useful.
        client_match = re.search(
            r"bill(?:ed)?\s+to[:\s]+[^\n]*\n([^\n]+)",
            text,
            re.IGNORECASE,
        )
        if not client_match:
            # Same-line fallback: stop before keywords like "Date:"
            client_match = re.search(
                r"bill(?:ed)?\s+to[:\s]+((?:(?!date:|due:|invoice:)[^\n,])+)",
                text,
                re.IGNORECASE,
            )
        if client_match:
            hints["client_name"] = client_match.group(1).strip()

        # Total: "Balance Due", "Grand Total", "Total Due", "Amount Due", "Total:"
        total_match = re.search(
            r"(?:balance\s*due|grand\s*total|total\s*due|amount\s*due|total)[:\s]*\$?([\d,]+\.?\d*)",
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
