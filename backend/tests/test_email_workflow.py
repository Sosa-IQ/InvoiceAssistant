from email import policy
from email.parser import BytesParser
from email.utils import parseaddr

import pytest
from pydantic import ValidationError

from app.config import settings
from app.models.schemas import SendInvoiceRequest
from app.services.email_service import EmailService


def _build(**overrides):
    kwargs = dict(
        recipient_email="client@example.com",
        cc_email=None,
        reply_to_email=None,
        from_display_name=None,
        subject="Invoice INV-ACME_01",
        message="Please see attached.",
        attachment_filename="INV-ACME_01.pdf",
        attachment_bytes=b"%PDF-test",
    )
    kwargs.update(overrides)
    message, _ = EmailService()._build_message(**kwargs)
    parsed = BytesParser(policy=policy.default).parsebytes(message.as_bytes())
    return parsed


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


def test_build_message_uses_display_name_when_provided(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "smtp_from_email", "invoices@example.com")
    monkeypatch.setattr(settings, "smtp_from_name", "Cuenvia")

    parsed = _build(from_display_name="Sosa IQ")
    assert parsed["From"] == "Sosa IQ <invoices@example.com>"


def test_build_message_falls_back_to_smtp_from_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "smtp_from_email", "invoices@example.com")
    monkeypatch.setattr(settings, "smtp_from_name", "Cuenvia")

    parsed = _build(from_display_name=None)
    assert parsed["From"] == "Cuenvia <invoices@example.com>"


def test_build_message_never_emits_bare_address(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "smtp_from_email", "invoices@example.com")
    monkeypatch.setattr(settings, "smtp_from_name", "")

    parsed = _build(from_display_name="   ")
    assert parseaddr(parsed["From"])[0] != ""


def test_send_request_accepts_and_normalizes_overrides() -> None:
    request = SendInvoiceRequest(
        subject="Invoice",
        message="Body",
        recipient_email="  client@example.com  ",
        cc_email="  boss@example.com ",
        reply_to_email=" billing@example.com ",
        from_display_name="  Sosa IQ  ",
    )

    assert request.recipient_email == "client@example.com"
    assert request.cc_email == "boss@example.com"
    assert request.reply_to_email == "billing@example.com"
    assert request.from_display_name == "Sosa IQ"


def test_send_request_defaults_overrides_to_none() -> None:
    request = SendInvoiceRequest(subject="Invoice", message="Body")

    assert request.recipient_email is None
    assert request.cc_email is None
    assert request.reply_to_email is None
    assert request.from_display_name is None


@pytest.mark.parametrize("field", ["recipient_email", "cc_email", "reply_to_email"])
def test_send_request_rejects_invalid_override_email(field: str) -> None:
    with pytest.raises(ValidationError):
        SendInvoiceRequest(subject="Invoice", message="Body", **{field: "not-an-email"})


@pytest.mark.parametrize("payload", ["Sosa\r\nBcc: attacker@example.com", "Sosa\nIQ", "Sosa\rIQ"])
def test_send_request_rejects_display_name_header_injection(payload: str) -> None:
    with pytest.raises(ValidationError):
        SendInvoiceRequest(subject="Invoice", message="Body", from_display_name=payload)


def test_send_request_rejects_overly_long_display_name() -> None:
    with pytest.raises(ValidationError):
        SendInvoiceRequest(subject="Invoice", message="Body", from_display_name="x" * 121)


def test_email_service_builds_pdf_message(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "smtp_from_email", "invoices@example.com")
    monkeypatch.setattr(settings, "smtp_from_name", "Cuenvia")

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
