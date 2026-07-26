import math
from pathlib import Path
from typing import Self

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = ""
    speechmatics_api_key: str = ""
    data_dir: Path = Path("./data")
    database_url: str
    max_upload_size_mb: int = 20
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_jwt_secret: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "invoices"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False
    smtp_from_email: str = ""
    smtp_from_name: str = "Invoice Assistant"
    app_environment: str = "development"
    log_level: str = "INFO"
    sentry_dsn: str = ""
    sentry_traces_sample_rate: float = 0.0
    email_send_limit: int = 10
    email_send_window_seconds: int = 600
    email_send_lease_seconds: int = 900
    invoice_generation_limit: int = 20
    invoice_generation_window_seconds: int = 3600

    @model_validator(mode="after")
    def validate_operational_security(self) -> Self:
        normalized_log_level = self.log_level.upper()
        if normalized_log_level not in {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}:
            raise ValueError("LOG_LEVEL must be CRITICAL, ERROR, WARNING, INFO, or DEBUG.")
        self.log_level = normalized_log_level
        if (
            not math.isfinite(self.sentry_traces_sample_rate)
            or not 0 <= self.sentry_traces_sample_rate <= 1
        ):
            raise ValueError("SENTRY_TRACES_SAMPLE_RATE must be finite and between 0 and 1.")
        if bool(self.smtp_username) != bool(self.smtp_password):
            raise ValueError("SMTP_USERNAME and SMTP_PASSWORD must be configured together.")
        if self.smtp_host and not self.smtp_from_email:
            raise ValueError("SMTP_FROM_EMAIL is required when SMTP_HOST is configured.")
        if (
            self.app_environment.lower() in {"prod", "production"}
            and self.smtp_host
            and not (self.smtp_use_tls or self.smtp_use_ssl)
        ):
            raise ValueError("Production SMTP requires TLS or SSL.")
        limits = (
            self.email_send_limit,
            self.email_send_window_seconds,
            self.email_send_lease_seconds,
            self.invoice_generation_limit,
            self.invoice_generation_window_seconds,
        )
        if any(value < 1 for value in limits):
            raise ValueError("Rate limits and windows must be positive.")
        return self

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def sqlalchemy_database_url(self) -> str:
        return self.database_url

    @property
    def invoices_dir(self) -> Path:
        return self.data_dir / "invoices"


settings = Settings()
