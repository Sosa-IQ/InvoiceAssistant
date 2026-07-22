from app.models.schemas import InvoiceData
from app.services.pdf_generator import PDFGeneratorService


def test_pdf_generator_recalculates_totals_and_renders_pdf() -> None:
    invoice = InvoiceData.model_validate(
        {
            "invoice_number": "INV-ACME_01",
            "issue_date": "2026-07-22",
            "status": "draft",
            "from": {"name": "Sosa IQ", "email": "billing@example.com"},
            "to": {
                "client_id": 1,
                "name": "Acme Corp",
                "email": "client@example.com",
            },
            "line_items": [
                {
                    "description": "AI consulting",
                    "quantity": 2,
                    "unit": "hour",
                    "unit_price": 125,
                    "subtotal": 0,
                }
            ],
            "totals": {"subtotal": 0, "grand_total": 0},
        }
    )
    generator = PDFGeneratorService()

    recalculated = generator.recalculate_totals(invoice)
    pdf = generator.render_pdf(recalculated)

    assert recalculated.line_items[0].subtotal == 250
    assert recalculated.totals.subtotal == 250
    assert recalculated.totals.grand_total == 250
    assert pdf.startswith(b"%PDF-")
    assert len(pdf) > 1_000
