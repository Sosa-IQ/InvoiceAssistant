import logging
import json
from collections import Counter, defaultdict
from typing import TypeVar

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.db_models import CatalogItem, InvoiceRecord
from app.models.schemas import (
    CatalogItemCreate,
    CatalogItemRead,
    CatalogItemUpdate,
    CatalogRecommendationRead,
    InvoiceData,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/catalog", tags=["catalog"])
T = TypeVar("T")


def _normalize_description(value: str) -> str:
    return " ".join(value.strip().lower().split())


def _most_common_value(values: list[T], fallback: T) -> T:
    if not values:
        return fallback
    return Counter(values).most_common(1)[0][0]


@router.get("", response_model=list[CatalogItemRead])
async def list_catalog(
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[CatalogItemRead]:
    """Return all catalog items, optionally filtered by description (case-insensitive)."""
    query = select(CatalogItem).order_by(CatalogItem.description)
    if search:
        query = query.where(CatalogItem.description.ilike(f"%{search}%"))
    result = await db.execute(query)
    return [CatalogItemRead.model_validate(r) for r in result.scalars().all()]


@router.post("", response_model=CatalogItemRead, status_code=201)
async def create_catalog_item(
    body: CatalogItemCreate,
    db: AsyncSession = Depends(get_db),
) -> CatalogItemRead:
    item = CatalogItem(**body.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    logger.info("Created catalog item id=%d description=%s", item.id, item.description)
    return CatalogItemRead.model_validate(item)


@router.post("/recommendations", response_model=list[CatalogRecommendationRead])
async def recommend_catalog_items(
    db: AsyncSession = Depends(get_db),
) -> list[CatalogRecommendationRead]:
    """
    Recommend catalog items from structured exported invoice data.

    Uploaded PDFs currently store text chunks for RAG, but exported invoices keep
    line items as JSON, which is reliable enough to turn into saveable catalog
    recommendations.
    """
    catalog_result = await db.execute(select(CatalogItem.description))
    existing_descriptions = {
        _normalize_description(description)
        for description in catalog_result.scalars().all()
    }

    records_result = await db.execute(
        select(InvoiceRecord)
        .where(InvoiceRecord.invoice_json.is_not(None))
        .order_by(InvoiceRecord.created_at.desc())
    )

    grouped: dict[str, dict] = defaultdict(
        lambda: {
            "descriptions": [],
            "units": [],
            "prices": [],
            "invoice_examples": [],
        }
    )

    for record in records_result.scalars().all():
        try:
            invoice = InvoiceData.model_validate(json.loads(record.invoice_json or "{}"))
        except Exception:
            logger.warning("Skipping invalid invoice_json for record id=%d", record.id)
            continue

        invoice_label = invoice.invoice_number or record.filename
        for line_item in invoice.line_items:
            description = line_item.description.strip()
            if not description:
                continue

            key = _normalize_description(description)
            if key in existing_descriptions:
                continue

            bucket = grouped[key]
            bucket["descriptions"].append(description)
            bucket["units"].append(line_item.unit or "item")
            bucket["prices"].append(round(float(line_item.unit_price or 0.0), 2))
            if invoice_label and invoice_label not in bucket["invoice_examples"]:
                bucket["invoice_examples"].append(invoice_label)

    recommendations: list[CatalogRecommendationRead] = []
    for bucket in grouped.values():
        count = len(bucket["descriptions"])
        if count == 0:
            continue

        description = _most_common_value(bucket["descriptions"], "")
        unit = _most_common_value(bucket["units"], "item")
        unit_price = _most_common_value(bucket["prices"], 0.0)
        examples = bucket["invoice_examples"][:3]
        confidence = min(0.95, 0.45 + (count * 0.1))
        reason = (
            f"Found {count} invoice line item"
            f"{'' if count == 1 else 's'} with this description."
        )

        recommendations.append(
            CatalogRecommendationRead(
                description=description,
                unit=unit,
                unit_price=unit_price,
                notes="Recommended from stored invoices.",
                confidence=round(confidence, 2),
                reason=reason,
                invoice_examples=examples,
            )
        )

    recommendations.sort(key=lambda item: (-item.confidence, item.description.lower()))
    return recommendations[:20]


@router.get("/{item_id}", response_model=CatalogItemRead)
async def get_catalog_item(
    item_id: int,
    db: AsyncSession = Depends(get_db),
) -> CatalogItemRead:
    result = await db.execute(select(CatalogItem).where(CatalogItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, f"Catalog item {item_id} not found.")
    return CatalogItemRead.model_validate(item)


@router.put("/{item_id}", response_model=CatalogItemRead)
async def update_catalog_item(
    item_id: int,
    body: CatalogItemUpdate,
    db: AsyncSession = Depends(get_db),
) -> CatalogItemRead:
    result = await db.execute(select(CatalogItem).where(CatalogItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, f"Catalog item {item_id} not found.")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    await db.commit()
    await db.refresh(item)
    return CatalogItemRead.model_validate(item)


@router.delete("/{item_id}", status_code=204)
async def delete_catalog_item(
    item_id: int,
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(select(CatalogItem).where(CatalogItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, f"Catalog item {item_id} not found.")
    await db.delete(item)
    await db.commit()
    logger.info("Deleted catalog item id=%d", item_id)
