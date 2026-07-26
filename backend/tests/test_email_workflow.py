from email import policy
from email.parser import BytesParser

import pytest
from pydantic import ValidationError

from app.config import settings
from app.models.schemas import SendInvoiceRequest
from app.services.email_service import EmailService


def test_send_invoice_request_normalizes_content() -> None:
    request = SendInvoiceRequest(subject="  Invoice INV-ACME_01  ", message="  Please see attached.  ")

    assert request.subject == "Invoice INV-ACME_01"
    assert request.message == "Please see attached."


@pytest.mark.parametrize(
    ("subject", "message"),
    [
        ("   ", "Valid body"),
        ("Valid subject", "   "),
        ("Invoice\nBcc: attacker@example.com", "Valid body"),
    ],
)
def test_send_invoice_request_rejects_blank_or_header_injection(subject: str, message: str) -> None:
    with pytest.raises(ValidationError):
        SendInvoiceRequest(subject=subject, message=message)


def test_email_service_builds_pdf_message(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "smtp_from_email", "invoices@example.com")
    monkeypatch.setattr(settings, "smtp_from_name", "Invoice Assistant")

    message, message_id = EmailService()._build_message(
        recipient_email="client@example.com",
        cc_email="owner@example.com",
        reply_to_email="billing@example.com",
        from_display_name="Sosa IQ",
        subject="Invoice INV-ACME_01",
        message="Please see attached.",
        attachment_filename="INV-ACME_01.pdf",
        attachment_bytes=b"%PDF-test",
    )

    parsed = BytesParser(policy=policy.default).parsebytes(message.as_bytes())
    assert parsed["From"] == "Sosa IQ <invoices@example.com>"
    assert parsed["To"] == "client@example.com"
    assert parsed["Cc"] == "owner@example.com"
    assert parsed["Reply-To"] == "billing@example.com"
    assert parsed["Message-ID"] == message_id

    attachment = next(parsed.iter_attachments())
    assert attachment.get_content_type() == "application/pdf"
    assert attachment.get_filename() == "INV-ACME_01.pdf"
    assert attachment.get_payload(decode=True) == b"%PDF-test"
