from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class BusinessSettings(Base):
    __tablename__ = "business_settings"
    __table_args__ = (CheckConstraint("id = 1", name="single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    name: Mapped[str | None] = mapped_column(String)
    address: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(String)
    phone: Mapped[str | None] = mapped_column(String)
    tax_id: Mapped[str | None] = mapped_column(String)
    logo_path: Mapped[str | None] = mapped_column(String)
    default_currency: Mapped[str] = mapped_column(String, default="USD")
    default_tax_pct: Mapped[float] = mapped_column(Float, default=0.0)
    payment_terms: Mapped[str] = mapped_column(String, default="Net 30")
    bank_name: Mapped[str | None] = mapped_column(String)
    account_name: Mapped[str | None] = mapped_column(String)
    account_number: Mapped[str | None] = mapped_column(String)
    routing_number: Mapped[str | None] = mapped_column(String)
    payment_notes: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), onupdate=func.now()
    )


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False, index=True)
    address: Mapped[str | None] = mapped_column(Text)  # kept for legacy; use ClientAddress going forward
    email: Mapped[str | None] = mapped_column(String)
    phone: Mapped[str | None] = mapped_column(String)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), onupdate=func.now()
    )

    addresses: Mapped[list["ClientAddress"]] = relationship(
        "ClientAddress", cascade="all, delete-orphan", lazy="raise"
    )


class ClientAddress(Base):
    __tablename__ = "client_addresses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str | None] = mapped_column(String)  # e.g. "123 Main St property"
    address: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())


class CatalogItem(Base):
    __tablename__ = "catalog_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    description: Mapped[str] = mapped_column(String, nullable=False, index=True)
    unit_price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    unit: Mapped[str] = mapped_column(String, nullable=False, default="item")
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), onupdate=func.now()
    )


class InvoiceRecord(Base):
    __tablename__ = "invoice_records"
    __table_args__ = (
        CheckConstraint(
            "source IN ('uploaded', 'generated')", name="valid_source"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False)
    invoice_number: Mapped[str | None] = mapped_column(String, index=True)
    client_name: Mapped[str | None] = mapped_column(String, index=True)
    issue_date: Mapped[str | None] = mapped_column(String)  # stored as ISO date string
    grand_total: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String, default="USD")
    chroma_doc_id: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
