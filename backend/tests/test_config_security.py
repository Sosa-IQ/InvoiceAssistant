import pytest
from pydantic import ValidationError

from app.config import Settings


def _base(**overrides):
    """Force isolation from the developer's live backend/.env / process env."""
    values = {
        "database_url": "postgresql+asyncpg://localhost/invoice_assistant",
        "frontend_url": "http://localhost:5173",
        "app_environment": "development",
        "smtp_host": "",
        "smtp_username": "",
        "smtp_password": "",
        "smtp_from_email": "",
        "smtp_use_tls": True,
        "smtp_use_ssl": False,
        "stripe_secret_key": "",
        "stripe_webhook_secret": "",
        "stripe_pro_price_id": "",
        "stripe_pro_yearly_price_id": "",
        "billing_enforcement_enabled": False,
        "_env_file": None,
    }
    values.update(overrides)
    return Settings(**values)


def test_partial_smtp_credentials_are_rejected() -> None:
    with pytest.raises(ValidationError, match="must be configured together"):
        _base(smtp_username="mailer")


def test_smtp_host_requires_from_address() -> None:
    with pytest.raises(ValidationError, match="SMTP_FROM_EMAIL"):
        _base(smtp_host="smtp.example.test")


def test_production_smtp_requires_transport_encryption() -> None:
    with pytest.raises(ValidationError, match="requires TLS or SSL"):
        _base(
            app_environment="production",
            frontend_url="https://app.example.test",
            smtp_host="smtp.example.test",
            smtp_from_email="billing@example.test",
            smtp_use_tls=False,
            smtp_use_ssl=False,
        )


def test_non_positive_rate_limit_is_rejected() -> None:
    with pytest.raises(ValidationError, match="must be positive"):
        _base(email_send_limit=0)


@pytest.mark.parametrize("value", [-0.1, 1.1, float("inf"), float("nan")])
def test_sentry_trace_sample_rate_must_be_finite_probability(value: float) -> None:
    with pytest.raises(ValidationError, match="SENTRY_TRACES_SAMPLE_RATE"):
        _base(sentry_traces_sample_rate=value)


def test_log_level_is_validated_and_normalized() -> None:
    assert _base(log_level="warning").log_level == "WARNING"
    with pytest.raises(ValidationError, match="LOG_LEVEL"):
        _base(log_level="verbose")


def test_secure_production_smtp_configuration_is_accepted() -> None:
    configured = _base(
        app_environment="production",
        frontend_url="https://app.example.test",
        smtp_host="smtp.example.test",
        smtp_from_email="billing@example.test",
        smtp_use_tls=True,
    )

    assert configured.smtp_use_tls is True
