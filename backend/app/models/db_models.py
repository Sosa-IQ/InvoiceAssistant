from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import ARRAY as PGARRAY
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[str] = mapped_column(PGUUID(as_uuid=False), primary_key=True)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())


class BusinessSettings(Base):
    __tablename__ = "business_settings"
    __table_args__ = (UniqueConstraint("user_id", name="uq_business_settings_user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(PGUUID(as_uuid=False), ForeignKey("profiles.id"), nullable=False, index=True)
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
    default_email_subject: Mapped[str] = mapped_column(
        String(200), default="Invoice {invoice_number}"
    )
    default_email_message: Mapped[str] = mapped_column(
        Text,
        default=(
            "Hello {client_name},\n\n"
            "Please find invoice {invoice_number} attached.\n\n"
            "Best,\n{business_name}"
        ),
    )
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=func.now(), onupdate=func.now()
    )


class Client(Base):
    __tablename__ = "clients"
    __table_args__ = (UniqueConstraint("user_id", "client_code", name="uq_clients_user_id_client_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(PGUUID(as_uuid=False), ForeignKey("profiles.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False, index=True)
    client_code: Mapped[str | None] = mapped_column(String(32), index=True)
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
    user_id: Mapped[str] = mapped_column(PGUUID(as_uuid=False), ForeignKey("profiles.id"), nullable=False, index=True)
    client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str | None] = mapped_column(String)  # e.g. "123 Main St property"
    address: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())


class CatalogItem(Base):
    __tablename__ = "catalog_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(PGUUID(as_uuid=False), ForeignKey("profiles.id"), nullable=False, index=True)
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
        UniqueConstraint(
            "user_id",
            "client_id",
            "client_invoice_sequence",
            name="uq_invoice_records_user_client_sequence",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(PGUUID(as_uuid=False), ForeignKey("profiles.id"), nullable=False, index=True)
    client_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("clients.id", ondelete="SET NULL"), index=True)
    client_invoice_sequence: Mapped[int | None] = mapped_column(Integer)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    storage_path: Mapped[str | None] = mapped_column(String)
    source: Mapped[str] = mapped_column(String, nullable=False)
    invoice_number: Mapped[str | None] = mapped_column(String, index=True)
    client_name: Mapped[str | None] = mapped_column(String, index=True)
    issue_date: Mapped[str | None] = mapped_column(String)  # stored as ISO date string
    grand_total: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String, default="USD")
    rag_doc_id: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="draft")
    invoice_json: Mapped[str | None] = mapped_column(Text)  # full InvoiceData JSON, stored at export time
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())


class InvoiceEmail(Base):
    __tablename__ = "invoice_emails"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "idempotency_key", name="uq_invoice_emails_user_idempotency"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(PGUUID(as_uuid=False), ForeignKey("profiles.id"), nullable=False, index=True)
    invoice_record_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("invoice_records.id", ondelete="CASCADE"), nullable=False, index=True
    )
    recipient_email: Mapped[str] = mapped_column(String, nullable=False)
    cc_email: Mapped[str | None] = mapped_column(String)
    subject: Mapped[str] = mapped_column(String, nullable=False)
    message_body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    provider: Mapped[str] = mapped_column(String, nullable=False, default="smtp")
    provider_message_id: Mapped[str | None] = mapped_column(String)
    idempotency_key: Mapped[str | None] = mapped_column(String(128))
    request_fingerprint: Mapped[str | None] = mapped_column(String(64))
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    attempt_token: Mapped[str | None] = mapped_column(String(36))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now())


class SecurityEvent(Base):
    __tablename__ = "security_events"
    __table_args__ = (
        CheckConstraint("outcome IN ('allowed', 'blocked')", name="ck_security_events_outcome"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        PGUUID(as_uuid=False), ForeignKey("profiles.id"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    request_id: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now()
    )


class Subscription(Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        CheckConstraint("plan IN ('free', 'pro')", name="ck_subscriptions_plan"),
        UniqueConstraint("user_id", name="uq_subscriptions_user_id"),
        UniqueConstraint("stripe_customer_id", name="uq_subscriptions_customer"),
        UniqueConstraint("stripe_subscription_id", name="uq_subscriptions_subscription"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        PGUUID(as_uuid=False), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    plan: Mapped[str] = mapped_column(String(32), nullable=False, default="free")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="free")
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255))
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255))
    stripe_price_id: Mapped[str | None] = mapped_column(String(255))
    # Durable history of prior Stripe subscription ids this row has been bound to.
    # A superseded id can never rebind again, even after future cancellations.
    superseded_subscription_ids: Mapped[list[str]] = mapped_column(
        PGARRAY(Text), nullable=False, server_default=text("'{}'::text[]"), default=list
    )
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_event_created_at: Mapped[int | None] = mapped_column(BigInteger)
    checkout_idempotency_key: Mapped[str | None] = mapped_column(String(64))
    checkout_idempotency_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The most recent open Checkout session for this row, reused instead of
    # minting a second session while Stripe still has one open.
    checkout_session_id: Mapped[str | None] = mapped_column(String(255))
    checkout_session_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now()
    )


class StripeWebhookEvent(Base):
    __tablename__ = "stripe_webhook_events"

    event_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(255), nullable=False)
    event_created_at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=func.now())
