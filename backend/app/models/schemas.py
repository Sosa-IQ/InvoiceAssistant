import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

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
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


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

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: Optional[str]) -> Optional[str]:
        return _validate_optional_email(value)


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
    prompt: str = Field(..., min_length=1, max_length=2000)


class GenerateInvoiceResponse(BaseModel):
    invoice: InvoiceData
    rag_docs_used: int = 0


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

    @field_validator("subject", "message")
    @classmethod
    def normalize_email_content(cls, value: str, info) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError(f"{info.field_name.replace('_', ' ').title()} cannot be blank.")
        if info.field_name == "subject" and ("\r" in normalized or "\n" in normalized):
            raise ValueError("Subject must be a single line.")
        return normalized


class SendInvoiceResponse(BaseModel):
    email: InvoiceEmailRead
