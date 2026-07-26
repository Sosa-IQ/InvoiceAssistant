#!/usr/bin/env python3
"""Verify SMTP connectivity, TLS, and authentication without sending mail."""

import argparse
import smtplib
import ssl
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-auth",
        action="store_true",
        help="Check DNS/TLS only; do not authenticate.",
    )
    args = parser.parse_args()

    if not settings.smtp_host or not settings.smtp_from_email:
        print("FAIL: SMTP_HOST and SMTP_FROM_EMAIL must be configured.")
        return 2
    if settings.smtp_username and not settings.smtp_password and not args.skip_auth:
        print("FAIL: SMTP_USERNAME is set but SMTP_PASSWORD is missing.")
        return 2

    context = ssl.create_default_context()
    try:
        if settings.smtp_use_ssl:
            server = smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=15,
                context=context,
            )
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
        with server:
            server.ehlo()
            if settings.smtp_use_tls and not settings.smtp_use_ssl:
                server.starttls(context=context)
                server.ehlo()
            if settings.smtp_username and not args.skip_auth:
                server.login(settings.smtp_username, settings.smtp_password)
            code, _ = server.noop()
            if code != 250:
                print(f"FAIL: SMTP NOOP returned status {code}.")
                return 1
    except (OSError, smtplib.SMTPException) as exc:
        print(f"FAIL: {type(exc).__name__}; check host, port, TLS mode, and credentials.")
        return 1

    auth_status = "skipped" if args.skip_auth or not settings.smtp_username else "verified"
    print(
        f"OK: SMTP connection/TLS verified; authentication {auth_status}; no email sent."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
