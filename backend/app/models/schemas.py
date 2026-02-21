from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Business Settings
# ---------------------------------------------------------------------------

class BusinessSettingsRead(BaseModel):
    id: int = 1
    name: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    logo_path: Optional[str] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class BusinessSettingsUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    logo_path: Optional[str] = None


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------

class ClientAddressCreate(BaseModel):
    label: Optional[str] = None
    address: str


class ClientAddressRead(BaseModel):
    id: int
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


class ClientRead(BaseModel):
    id: int
    name: str
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


# ---------------------------------------------------------------------------
# Invoice Records (history list)
# ---------------------------------------------------------------------------

class InvoiceRecordRead(BaseModel):
    id: int
    filename: str
    file_path: str
    source: str
    invoice_number: Optional[str] = None
    client_name: Optional[str] = None
    issue_date: Optional[str] = None
    grand_total: Optional[float] = None
    currency: str = "USD"
    chroma_doc_id: Optional[str] = None
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
