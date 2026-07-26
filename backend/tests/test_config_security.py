import pytest
from pydantic import ValidationError

from app.config import Settings


BASE = {"database_url": "postgresql+asyncpg://localhost/invoice_assistant", "_env_file": None}


def test_partial_smtp_credentials_are_rejected() -> None:
    with pytest.raises(ValidationError, match="must be configured together"):
        Settings(**BASE, smtp_username="mailer")


def test_smtp_host_requires_from_address() -> None:
    with pytest.raises(ValidationError, match="SMTP_FROM_EMAIL"):
        Settings(**BASE, smtp_host="smtp.example.test")


def test_production_smtp_requires_transport_encryption() -> None:
    with pytest.raises(ValidationError, match="requires TLS or SSL"):
        Settings(
            **BASE,
            app_environment="production",
            smtp_host="smtp.example.test",
            smtp_from_email="billing@example.test",
            smtp_use_tls=False,
            smtp_use_ssl=False,
        )


def test_non_positive_rate_limit_is_rejected() -> None:
    with pytest.raises(ValidationError, match="must be positive"):
        Settings(**BASE, email_send_limit=0)


@pytest.mark.parametrize("value", [-0.1, 1.1, float("inf"), float("nan")])
def test_sentry_trace_sample_rate_must_be_finite_probability(value: float) -> None:
    with pytest.raises(ValidationError, match="SENTRY_TRACES_SAMPLE_RATE"):
        Settings(**BASE, sentry_traces_sample_rate=value)


def test_log_level_is_validated_and_normalized() -> None:
    assert Settings(**BASE, log_level="warning").log_level == "WARNING"
    with pytest.raises(ValidationError, match="LOG_LEVEL"):
        Settings(**BASE, log_level="verbose")


def test_secure_production_smtp_configuration_is_accepted() -> None:
    configured = Settings(
        **BASE,
        app_environment="production",
        smtp_host="smtp.example.test",
        smtp_from_email="billing@example.test",
        smtp_use_tls=True,
    )

    assert configured.smtp_use_tls is True
