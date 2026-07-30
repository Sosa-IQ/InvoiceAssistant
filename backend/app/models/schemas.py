import re
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, computed_field, field_validator

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_optional_email(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if not EMAIL_RE.match(normalized):
        raise ValueError("Invalid email address.")
    return normalized


# ---------------------------------------------------------------------------
# Email templates
# ---------------------------------------------------------------------------
#
# Templates are rendered by substituting only these named placeholders — never
# via `eval` or `str.format_map` against uncontrolled input. Anything else in
# curly braces is rejected at write time so the allowlist stays authoritative.

EMAIL_TEMPLATE_PLACEHOLDERS = frozenset(
    {"invoice_number", "client_name", "business_name", "issue_date", "total", "currency"}
)
_PLACEHOLDER_RE = re.compile(r"\{([a-zA-Z0-9_]+)\}")

DEFAULT_EMAIL_SUBJECT_TEMPLATE = "Invoice {invoice_number}"
DEFAULT_EMAIL_MESSAGE_TEMPLATE = (
    "Hello {client_name},\n\n"
    "Please find invoice {invoice_number} attached.\n\n"
    "Best,\n{business_name}"
)


def _validate_email_template(value: str, *, field_name: str, single_line: bool) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field_name} cannot be blank.")
    if single_line and ("\r" in normalized or "\n" in normalized):
        raise ValueError(f"{field_name} must be a single line.")
    for match in _PLACEHOLDER_RE.finditer(normalized):
        placeholder = match.group(1)
        if placeholder not in EMAIL_TEMPLATE_PLACEHOLDERS:
            raise ValueError(f"Unknown placeholder {{{placeholder}}} in {field_name}.")
    without_valid_placeholders = _PLACEHOLDER_RE.sub("", normalized)
    if "{" in without_valid_placeholders or "}" in without_valid_placeholders:
        raise ValueError(f"Malformed placeholder syntax in {field_name}.")
    return normalized


# ---------------------------------------------------------------------------
# Business Settings
# ---------------------------------------------------------------------------

class BusinessSettingsRead(BaseModel):
    id: int = 1
    user_id: str
    name: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    logo_path: Optional[str] = None
    tax_id: Optional[str] = None
    default_currency: str = "USD"
    default_tax_pct: float = 0.0
    payment_terms: str = "Net 30"
    bank_name: Optional[str] = None
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    routing_number: Optional[str] = None
    payment_notes: Optional[str] = None
    default_email_subject: str = DEFAULT_EMAIL_SUBJECT_TEMPLATE
    default_email_message: str = DEFAULT_EMAIL_MESSAGE_TEMPLATE
    onboarding_completed_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}

    @computed_field  # type: ignore[prop-decorator]
    @property
    def onboarding_completed(self) -> bool:
        return self.onboarding_completed_at is not None


class BusinessSettingsUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    logo_path: Optional[str] = None
    tax_id: Optional[str] = None
    default_currency: Optional[str] = None
    default_tax_pct: Optional[float] = None
    payment_terms: Optional[str] = None
    bank_name: Optional[str] = None
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    routing_number: Optional[str] = None
    payment_notes: Optional[str] = None
    default_email_subject: str = Field(default=DEFAULT_EMAIL_SUBJECT_TEMPLATE, max_length=200)
    default_email_message: str = Field(default=DEFAULT_EMAIL_MESSAGE_TEMPLATE, max_length=5000)
    # Omission leaves onboarding state unchanged. The completion timestamp is
    # set server-side; clients may only toggle this boolean, never write a time.
    onboarding_completed: Optional[bool] = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: Optional[str]) -> Optional[str]:
        return _validate_optional_email(value)

    @field_validator("default_email_subject")
    @classmethod
    def validate_default_email_subject(cls, value: str) -> str:
        return _validate_email_template(value, field_name="Subject template", single_line=True)

    @field_validator("default_email_message")
    @classmethod
    def validate_default_email_message(cls, value: str) -> str:
        return _validate_email_template(value, field_name="Message template", single_line=False)


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------

class ClientAddressCreate(BaseModel):
    label: Optional[str] = None
    address: str


class ClientAddressRead(BaseModel):
    id: int
    user_id: str
    client_id: int
    label: Optional[str] = None
    address: str
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ClientCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: Optional[str]) -> Optional[str]:
        return _validate_optional_email(value)


class ClientRead(BaseModel):
    id: int
    user_id: str
    name: str
    client_code: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    addresses: list[ClientAddressRead] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: Optional[str]) -> Optional[str]:
        return _validate_optional_email(value)


# ---------------------------------------------------------------------------
# Catalog Items
# ---------------------------------------------------------------------------

class CatalogItemCreate(BaseModel):
    description: str
    unit_price: float = 0.0
    unit: str = "item"
    notes: Optional[str] = None


class CatalogItemRead(BaseModel):
    id: int
    user_id: str
    description: str
    unit_price: float
    unit: str
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class CatalogItemUpdate(BaseModel):
    description: Optional[str] = None
    unit_price: Optional[float] = None
    unit: Optional[str] = None
    notes: Optional[str] = None


class CatalogRecommendationRead(BaseModel):
    description: str
    unit_price: float
    unit: str
    notes: Optional[str] = None
    confidence: float = 0.0
    reason: str
    invoice_examples: list[str] = []


# ---------------------------------------------------------------------------
# Invoice Records (history list)
# ---------------------------------------------------------------------------

class InvoiceRecordRead(BaseModel):
    id: int
    user_id: str
    client_id: Optional[int] = None
    client_invoice_sequence: Optional[int] = None
    filename: str
    file_path: str
    storage_path: Optional[str] = None
    source: str
    invoice_number: Optional[str] = None
    client_name: Optional[str] = None
    issue_date: Optional[str] = None
    grand_total: Optional[float] = None
    currency: str = "USD"
    rag_doc_id: Optional[str] = None
    status: str
    invoice_json: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Bulk upload response
# ---------------------------------------------------------------------------

class UploadResult(BaseModel):
    filename: str
    success: bool
    record: Optional[InvoiceRecordRead] = None
    error: Optional[str] = None


class BulkUploadResponse(BaseModel):
    results: list[UploadResult]
    total: int
    succeeded: int
    failed: int


# ---------------------------------------------------------------------------
# Invoice JSON Schema (OpenAI output contract + editor payload)
# ---------------------------------------------------------------------------

class ContactInfo(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    logo_path: Optional[str] = None


class ClientContact(BaseModel):
    client_id: Optional[int] = None
    name: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class LineItem(BaseModel):
    description: str = ""
    quantity: float = 1.0
    unit: str = "item"
    unit_price: float = 0.0
    subtotal: float = 0.0


class Totals(BaseModel):
    subtotal: float = 0.0
    grand_total: float = 0.0


class InvoiceData(BaseModel):
    invoice_number: Optional[str] = None
    issue_date: Optional[str] = None
    status: str = "draft"
    from_: ContactInfo = Field(default_factory=ContactInfo, alias="from")
    to: ClientContact = Field(default_factory=ClientContact)
    line_items: list[LineItem] = Field(default_factory=list)
    totals: Totals = Field(default_factory=Totals)
    notes: Optional[str] = None

    model_config = {"populate_by_name": True}


class InvoiceSchema(BaseModel):
    invoice: InvoiceData


# ---------------------------------------------------------------------------
# API request/response bodies
# ---------------------------------------------------------------------------

class GenerateInvoiceRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)


class GenerateInvoiceResponse(BaseModel):
    invoice: InvoiceData
    rag_docs_used: int = 0


class ReviseInvoiceRequest(BaseModel):
    instruction: str = Field(..., min_length=1, max_length=8000)
    invoice: InvoiceData


class NextInvoiceNumberResponse(BaseModel):
    client_id: int
    client_code: str
    client_invoice_sequence: int
    invoice_number: str


class ProfileRead(BaseModel):
    id: str
    email: str
    display_name: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class AuthSignupRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=8, max_length=255)
    display_name: Optional[str] = Field(default=None, max_length=255)


class AuthMeResponse(BaseModel):
    user: ProfileRead


class InvoiceEmailRead(BaseModel):
    id: int
    user_id: str
    invoice_record_id: int
    recipient_email: str
    cc_email: Optional[str] = None
    subject: str
    message_body: str
    status: str
    provider: str
    provider_message_id: Optional[str] = None
    error_message: Optional[str] = None
    sent_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class SendInvoiceRequest(BaseModel):
    subject: str = Field(..., min_length=1, max_length=200)
    message: str = Field(..., min_length=1, max_length=5000)
    recipient_email: Optional[str] = None
    cc_email: Optional[str] = None
    reply_to_email: Optional[str] = None
    from_display_name: Optional[str] = None
    idempotency_key: Optional[str] = Field(
        default=None,
        min_length=8,
        max_length=128,
        pattern=r"^[A-Za-z0-9._-]+$",
    )

    @field_validator("subject", "message")
    @classmethod
    def normalize_email_content(cls, value: str, info) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError(f"{info.field_name.replace('_', ' ').title()} cannot be blank.")
        if info.field_name == "subject" and ("\r" in normalized or "\n" in normalized):
            raise ValueError("Subject must be a single line.")
        return normalized

    @field_validator("recipient_email", "cc_email", "reply_to_email")
    @classmethod
    def validate_override_email(cls, value: Optional[str]) -> Optional[str]:
        return _validate_optional_email(value)

    @field_validator("from_display_name")
    @classmethod
    def validate_from_display_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        if "\r" in normalized or "\n" in normalized:
            raise ValueError("Sender display name must be a single line.")
        if len(normalized) > 120:
            raise ValueError("Sender display name is too long.")
        return normalized


class ReconcileInvoiceEmailRequest(BaseModel):
    resolution: Literal["delivered", "not_delivered"]


class InvoiceEmailAttemptRead(InvoiceEmailRead):
    idempotency_key: Optional[str] = None
    attempt_count: int
    lease_expires_at: Optional[datetime] = None


class SendInvoiceResponse(BaseModel):
    email: InvoiceEmailRead


class BillingPlanRead(BaseModel):
    code: Literal["free", "pro"]
    name: str
    price_cents: int
    currency: str
    interval: Literal["month", "year"]
    features: list[str]


class BillingPlansResponse(BaseModel):
    configured: bool
    enforcement_enabled: bool
    plans: list[BillingPlanRead]


class BillingStatusRead(BaseModel):
    plan: Literal["free", "pro"] = "free"
    status: str = "free"
    stripe_customer_id: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
    stripe_price_id: Optional[str] = None
    current_period_end: Optional[datetime] = None
    cancel_at_period_end: bool = False
    configured: bool
    enforcement_enabled: bool


class UsageStatusRead(BaseModel):
    pro_entitled: bool
    period_start: datetime
    period_end: datetime
    ai_tokens_included: int
    ai_tokens_used: int
    ai_tokens_pack_remaining: int
    ai_tokens_remaining: int
    ai_usage_ratio: float
    voice_seconds_included: int
    voice_seconds_used: int
    voice_seconds_pack_remaining: int
    voice_seconds_remaining: int
    voice_usage_ratio: float
    packs_frozen: bool
    ai_pack_configured: bool
    voice_pack_configured: bool


class PackCheckoutRequest(BaseModel):
    pack: Literal["ai_tokens", "voice_seconds"]


class CheckoutSessionRequest(BaseModel):
    """Optional body; defaults to monthly Pro when omitted."""
    interval: Literal["month", "year"] = "month"


class BillingSessionResponse(BaseModel):
    url: str
