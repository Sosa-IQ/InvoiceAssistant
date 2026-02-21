import base64
import logging
from pathlib import Path

import weasyprint
from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.models.schemas import InvoiceData, Totals

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).parent.parent / "templates"


class PDFGeneratorService:
    def __init__(self) -> None:
        self.env = Environment(
            loader=FileSystemLoader(str(TEMPLATES_DIR)),
            autoescape=select_autoescape(["html"]),
        )

    def recalculate_totals(self, invoice: InvoiceData) -> InvoiceData:
        """
        Recompute all line item subtotals and invoice totals server-side.
        This is the authoritative calculation — frontend values are ignored.
        """
        subtotal = 0.0
        discount_total = 0.0
        tax_total = 0.0

        for li in invoice.line_items:
            #DEBUG
            logger.info("Calculating line item: %s, qty=%s, unit_price=%s, discount_pct=%s, tax_pct=%s",
                         li.description, li.quantity, li.unit_price, li.discount_pct, li.tax_pct)
            li_subtotal = li.quantity * li.unit_price * (1 - li.discount_pct / 100)
            li_discount = li.quantity * li.unit_price * (li.discount_pct / 100)
            li_tax = li_subtotal * (li.tax_pct / 100)
            li.subtotal = round(li_subtotal, 10)
            subtotal += li_subtotal
            discount_total += li_discount
            tax_total += li_tax

        invoice.totals = Totals(
            subtotal=subtotal,
            discount_total=discount_total,
            tax_total=tax_total,
            grand_total=subtotal + tax_total,
        )
        #DEBUG
        logger.info("Recalculated totals: subtotal=%.2f, discount_total=%.2f, tax_total=%.2f, grand_total=%.2f",
                     invoice.totals.subtotal, invoice.totals.discount_total, invoice.totals.tax_total, invoice.totals.grand_total)
        return invoice

    def render_pdf(self, invoice: InvoiceData, logo_path: str | None = None) -> bytes:
        """
        Render the invoice to a PDF bytes object.

        Args:
            invoice: InvoiceData with recalculated totals.
            logo_path: Optional filesystem path to a logo image.

        Returns:
            Raw PDF bytes.
        """
        logo_data_uri: str | None = None
        if logo_path:
            logo_file = Path(logo_path)
            if logo_file.exists():
                suffix = logo_file.suffix.lower()
                mime = "image/png" if suffix == ".png" else "image/jpeg"
                encoded = base64.b64encode(logo_file.read_bytes()).decode()
                logo_data_uri = f"data:{mime};base64,{encoded}"
                logger.info("Loaded logo from %s (%d bytes)", logo_file, logo_file.stat().st_size)
            else:
                logger.warning("Logo path %s not found, skipping.", logo_path)

        template = self.env.get_template("invoice.html")
        # Serialize using alias=True so the template sees "from" (not "from_")
        invoice_dict = invoice.model_dump(by_alias=True)
        #DEBUG
        logger.info("Rendering invoice %s with data: %s", invoice.invoice_number, invoice_dict)
        html = template.render(invoice=invoice_dict, logo_data_uri=logo_data_uri)

        logger.info("Rendering PDF for invoice %s", invoice.invoice_number)
        pdf_bytes = weasyprint.HTML(string=html).write_pdf()
        logger.info("PDF rendered: %d bytes", len(pdf_bytes))
        return pdf_bytes
