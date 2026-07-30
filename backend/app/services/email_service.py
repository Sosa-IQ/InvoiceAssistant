import asyncio
import hashlib
import smtplib
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from app.config import settings


class EmailService:
    provider = "smtp"

    def is_configured(self) -> bool:
        return bool(settings.smtp_host and settings.smtp_from_email)

    @staticmethod
    def message_id_for_key(key: str) -> str:
        domain = (
            settings.smtp_from_email.split("@", 1)[1]
            if "@" in settings.smtp_from_email
            else "invoice-assistant.local"
        )
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:40]
        return f"<invoice-{digest}@{domain}>"

    def _build_message(
        self,
        *,
        recipient_email: str,
        cc_email: str | None,
        reply_to_email: str | None,
        from_display_name: str | None,
        subject: str,
        message: str,
        attachment_filename: str,
        attachment_bytes: bytes,
        message_id: str | None = None,
    ) -> tuple[EmailMessage, str]:
        msg = EmailMessage()
        sender_name = (from_display_name or settings.smtp_from_name or "Cuenvia").strip() or "Cuenvia"
        msg["From"] = formataddr((sender_name, settings.smtp_from_email))
        msg["To"] = recipient_email
        if cc_email:
            msg["Cc"] = cc_email
        if reply_to_email:
            msg["Reply-To"] = reply_to_email
        msg["Subject"] = subject
        message_id = message_id or make_msgid(domain=(settings.smtp_from_email.split("@", 1)[1] if "@" in settings.smtp_from_email else None))
        msg["Message-ID"] = message_id
        msg.set_content(message)
        msg.add_attachment(
            attachment_bytes,
            maintype="application",
            subtype="pdf",
            filename=attachment_filename,
        )
        return msg, message_id

    def _send_sync(self, msg: EmailMessage, recipients: list[str]) -> None:
        if settings.smtp_use_ssl:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=30) as server:
                if settings.smtp_username:
                    server.login(settings.smtp_username, settings.smtp_password)
                server.send_message(msg, to_addrs=recipients)
            return

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as server:
            if settings.smtp_use_tls:
                server.starttls()
            if settings.smtp_username:
                server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(msg, to_addrs=recipients)

    async def send_invoice_email(
        self,
        *,
        recipient_email: str,
        cc_email: str | None,
        reply_to_email: str | None,
        from_display_name: str | None,
        subject: str,
        message: str,
        attachment_filename: str,
        attachment_bytes: bytes,
        message_id: str | None = None,
    ) -> str:
        if not self.is_configured():
            raise RuntimeError("SMTP is not configured. Set SMTP_HOST and SMTP_FROM_EMAIL.")

        msg, message_id = self._build_message(
            recipient_email=recipient_email,
            cc_email=cc_email,
            reply_to_email=reply_to_email,
            from_display_name=from_display_name,
            subject=subject,
            message=message,
            attachment_filename=attachment_filename,
            attachment_bytes=attachment_bytes,
            message_id=message_id,
        )
        recipients = [recipient_email]
        if cc_email:
            recipients.append(cc_email)
        await asyncio.to_thread(self._send_sync, msg, recipients)
        return message_id
