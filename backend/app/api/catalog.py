import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.db_models import CatalogItem
from app.models.schemas import CatalogItemCreate, CatalogItemRead, CatalogItemUpdate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/catalog", tags=["catalog"])


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
