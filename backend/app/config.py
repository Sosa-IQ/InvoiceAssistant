import math
from pathlib import Path
from typing import Self
from urllib.parse import urlsplit

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
    smtp_from_name: str = "Cuenvia"
    app_environment: str = "development"
    log_level: str = "INFO"
    sentry_dsn: str = ""
    sentry_traces_sample_rate: float = 0.0
    email_send_limit: int = 10
    email_send_window_seconds: int = 600
    email_send_lease_seconds: int = 900
    invoice_generation_limit: int = 15
    invoice_generation_window_seconds: int = 3600
    # Pro included monthly allotments (do not roll over).
    ai_monthly_token_limit: int = 2_500_000
    voice_monthly_seconds: int = 3600
    voice_hourly_request_limit: int = 10
    voice_hourly_window_seconds: int = 3600
    voice_max_seconds_per_clip: int = 180
    voice_max_upload_mb: int = 8
    ai_max_prompt_chars: int = 8000
    # Global provider spend circuit breaker across all tenants (cents / 24h).
    global_daily_ai_budget_cents: int = 5000
    # One-time Pro-only top-up packs (optional until Stripe pack prices exist).
    stripe_ai_pack_price_id: str = ""
    stripe_voice_pack_price_id: str = ""
    ai_pack_tokens: int = 1_000_000
    voice_pack_seconds: int = 3600
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_pro_price_id: str = ""
    # Optional second Pro price on the same product (yearly). Empty = monthly only.
    stripe_pro_yearly_price_id: str = ""
    # Optional Stripe Promotion Code id (promo_…) auto-applied on monthly Pro Checkout.
    # Mutually exclusive with the Checkout "Add promotion code" field when set.
    # Prefer a monthly-only coupon / promotion code so yearly is not discounted twice.
    stripe_launch_promotion_code: str = ""
    stripe_pro_price_cents: int = 1200
    stripe_currency: str = "USD"
    stripe_expected_livemode: bool = False
    billing_enforcement_enabled: bool = False
    frontend_url: str = "http://localhost:5173"

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
            self.ai_monthly_token_limit,
            self.voice_monthly_seconds,
            self.voice_hourly_request_limit,
            self.voice_hourly_window_seconds,
            self.voice_max_seconds_per_clip,
            self.voice_max_upload_mb,
            self.ai_max_prompt_chars,
            self.global_daily_ai_budget_cents,
            self.ai_pack_tokens,
            self.voice_pack_seconds,
        )
        if any(value < 1 for value in limits):
            raise ValueError("Rate limits and windows must be positive.")
        stripe_values = (
            self.stripe_secret_key,
            self.stripe_webhook_secret,
            self.stripe_pro_price_id,
        )
        if any(stripe_values) and not all(stripe_values):
            raise ValueError(
                "Stripe secret key, webhook secret, and Pro price ID must be "
                "configured together or all left blank."
            )
        if self.billing_enforcement_enabled and not all(stripe_values):
            raise ValueError(
                "Stripe secret key, webhook secret, and Pro price ID are required "
                "when billing enforcement is enabled."
            )
        # When a Stripe secret key is configured, its mode must match the
        # explicit expected livemode so a test key can never be paired with a
        # live-mode webhook expectation (or vice versa). The disabled fallback
        # (no key) is intentionally left valid.
        if self.stripe_secret_key:
            is_live_key = self.stripe_secret_key.startswith("sk_live_")
            is_test_key = self.stripe_secret_key.startswith("sk_test_")
            if not (is_live_key or is_test_key):
                raise ValueError("STRIPE_SECRET_KEY must be an sk_test_ or sk_live_ server key.")
            if (is_live_key or is_test_key) and is_live_key != self.stripe_expected_livemode:
                raise ValueError(
                    "STRIPE_SECRET_KEY mode must match STRIPE_EXPECTED_LIVEMODE "
                    "(use sk_live_ only when STRIPE_EXPECTED_LIVEMODE is true)."
                )
        if self.stripe_pro_price_cents < 0:
            raise ValueError("STRIPE_PRO_PRICE_CENTS cannot be negative.")
        self.stripe_currency = self.stripe_currency.upper()
        if len(self.stripe_currency) != 3 or not self.stripe_currency.isalpha():
            raise ValueError("STRIPE_CURRENCY must be a three-letter currency code.")
        parsed_frontend = urlsplit(self.frontend_url.strip())
        if parsed_frontend.scheme not in {"http", "https"} or not parsed_frontend.hostname:
            raise ValueError("FRONTEND_URL must be an HTTP(S) origin.")
        try:
            parsed_frontend.port
        except ValueError as exc:
            raise ValueError("FRONTEND_URL contains an invalid port.") from exc
        if (
            parsed_frontend.username is not None
            or parsed_frontend.password is not None
            or parsed_frontend.path not in {"", "/"}
            or parsed_frontend.query
            or parsed_frontend.fragment
        ):
            raise ValueError(
                "FRONTEND_URL must contain only scheme, host, and optional port."
            )
        self.frontend_url = f"{parsed_frontend.scheme}://{parsed_frontend.netloc}"
        if (
            all(stripe_values)
            and self.app_environment.strip().lower() in {"production", "prod"}
            and not self.frontend_url.lower().startswith("https://")
        ):
            raise ValueError("Production FRONTEND_URL must use HTTPS.")
        return self

    @property
    def stripe_configured(self) -> bool:
        return bool(
            self.stripe_secret_key
            and self.stripe_webhook_secret
            and self.stripe_pro_price_id
        )

    @property
    def configured_pro_price_ids(self) -> frozenset[str]:
        ids = {self.stripe_pro_price_id}
        if self.stripe_pro_yearly_price_id:
            ids.add(self.stripe_pro_yearly_price_id)
        return frozenset(i for i in ids if i)

    def pro_price_id_for_interval(self, interval: str) -> str:
        if interval == "year":
            if not self.stripe_pro_yearly_price_id:
                raise ValueError("Yearly Pro price is not configured.")
            return self.stripe_pro_yearly_price_id
        if interval == "month":
            return self.stripe_pro_price_id
        raise ValueError(f"Unsupported billing interval: {interval}")

    @property
    def ai_pack_configured(self) -> bool:
        return self.stripe_configured and bool(self.stripe_ai_pack_price_id)

    @property
    def voice_pack_configured(self) -> bool:
        return self.stripe_configured and bool(self.stripe_voice_pack_price_id)

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def sqlalchemy_database_url(self) -> str:
        # Supabase dashboard copies often use postgresql://; SQLAlchemy needs the
        # asyncpg driver name. Normalize here so backend/.env works either way.
        url = self.database_url
        if url.startswith("postgresql://"):
            return "postgresql+asyncpg://" + url[len("postgresql://") :]
        if url.startswith("postgres://"):
            return "postgresql+asyncpg://" + url[len("postgres://") :]
        return url

    @property
    def invoices_dir(self) -> Path:
        return self.data_dir / "invoices"


settings = Settings()
