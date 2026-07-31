import logging
import json
import re
from collections import Counter, defaultdict
from typing import TypeVar

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthenticatedUser, get_current_user
from app.api.billing import require_pro_entitlement
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
ACTION_PREFIXES = {
    "complete",
    "completed",
    "finish",
    "finished",
    "finishing",
}
STOP_WORDS = ACTION_PREFIXES | {
    "and",
    "for",
    "of",
    "on",
    "the",
    "to",
}
VERB_REPLACEMENTS = {
    "installed": "install",
    "installing": "install",
    "repairs": "repair",
    "repaired": "repair",
    "repairing": "repair",
    "removed": "remove",
    "removing": "remove",
    "painted": "paint",
    "painting": "paint",
    "cleaned": "clean",
    "cleaning": "clean",
}


def _normalize_description(value: str) -> str:
    return " ".join(value.strip().lower().split())


def _clean_recommendation_description(value: str) -> str:
    text = value.strip()
    text = re.sub(r"^\s*\d{1,2}/\d{1,2}(?:/\d{2,4})?\s*[:\-–—]?\s*", "", text)
    text = re.sub(r"\s+", " ", text)

    words = text.split()
    while words and words[0].lower().strip(".,:;") in ACTION_PREFIXES:
        words.pop(0)

    cleaned_words = [
        VERB_REPLACEMENTS.get(word.lower().strip(".,:;"), word)
        for word in words
    ]
    cleaned = " ".join(cleaned_words).strip(" .,;:")
    return cleaned[:1].upper() + cleaned[1:] if cleaned else ""


def _recommendation_group_key(value: str) -> str:
    cleaned = _normalize_description(_clean_recommendation_description(value))
    words = [
        VERB_REPLACEMENTS.get(word.strip(".,:;"), word.strip(".,:;"))
        for word in cleaned.split()
    ]
    keywords = [word for word in words if word and word not in STOP_WORDS]
    return " ".join(keywords)


def _is_hourly_unit(value: str) -> bool:
    return _normalize_description(value) in {"hour", "hours", "hr", "hrs", "hourly"}


def _most_common_value(values: list[T], fallback: T) -> T:
    if not values:
        return fallback
    return Counter(values).most_common(1)[0][0]


@router.get("", response_model=list[CatalogItemRead])
async def list_catalog(
    search: str | None = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CatalogItemRead]:
    """Return all catalog items, optionally filtered by description (case-insensitive)."""
    query = select(CatalogItem).where(CatalogItem.user_id == current_user.id).order_by(CatalogItem.description)
    if search:
        query = query.where(CatalogItem.description.ilike(f"%{search}%"))
    result = await db.execute(query)
    return [CatalogItemRead.model_validate(r) for r in result.scalars().all()]


@router.post("", response_model=CatalogItemRead, status_code=201)
async def create_catalog_item(
    body: CatalogItemCreate,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CatalogItemRead:
    item = CatalogItem(user_id=current_user.id, **body.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    logger.info("catalog_item_created")
    return CatalogItemRead.model_validate(item)


@router.post("/recommendations", response_model=list[CatalogRecommendationRead])
async def recommend_catalog_items(
    current_user: AuthenticatedUser = Depends(require_pro_entitlement),
    db: AsyncSession = Depends(get_db),
) -> list[CatalogRecommendationRead]:
    """
    Recommend catalog items from structured exported invoice data (Pro).

    Uploaded PDFs currently store text chunks for RAG, but exported invoices keep
    line items as JSON, which is reliable enough to turn into saveable catalog
    recommendations.
    """
    catalog_result = await db.execute(select(CatalogItem.description).where(CatalogItem.user_id == current_user.id))
    existing_descriptions = {
        _recommendation_group_key(description)
        for description in catalog_result.scalars().all()
    }

    records_result = await db.execute(
        select(InvoiceRecord)
        .where(InvoiceRecord.user_id == current_user.id)
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
            logger.warning("catalog_invoice_json_invalid")
            continue

        invoice_label = invoice.invoice_number or record.filename
        for line_item in invoice.line_items:
            description = _clean_recommendation_description(line_item.description)
            if not description:
                continue

            key = _recommendation_group_key(description)
            if key in existing_descriptions:
                continue

            bucket = grouped[key]
            bucket["descriptions"].append(description)
            bucket["units"].append(line_item.unit or "item")
            if _is_hourly_unit(line_item.unit or ""):
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
        unit_price = _most_common_value(bucket["prices"], 0.0) if _is_hourly_unit(unit) else 0.0
        examples = bucket["invoice_examples"][:3]
        confidence = min(0.95, 0.45 + (count * 0.1))
        reason = (
            f"Found {count} invoice line item"
            f"{'' if count == 1 else 's'} with similar wording."
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
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CatalogItemRead:
    result = await db.execute(select(CatalogItem).where(CatalogItem.id == item_id, CatalogItem.user_id == current_user.id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, f"Catalog item {item_id} not found.")
    return CatalogItemRead.model_validate(item)


@router.put("/{item_id}", response_model=CatalogItemRead)
async def update_catalog_item(
    item_id: int,
    body: CatalogItemUpdate,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CatalogItemRead:
    result = await db.execute(select(CatalogItem).where(CatalogItem.id == item_id, CatalogItem.user_id == current_user.id))
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
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(select(CatalogItem).where(CatalogItem.id == item_id, CatalogItem.user_id == current_user.id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, f"Catalog item {item_id} not found.")
    await db.delete(item)
    await db.commit()
    logger.info("Deleted catalog item id=%d", item_id)
