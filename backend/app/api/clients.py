import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.db_models import Client
from app.models.schemas import ClientCreate, ClientRead, ClientUpdate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/clients", tags=["clients"])


@router.get("", response_model=list[ClientRead])
async def list_clients(
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[ClientRead]:
    """Return all clients, optionally filtered by name (case-insensitive substring)."""
    query = select(Client).order_by(Client.name)
    if search:
        query = query.where(Client.name.ilike(f"%{search}%"))
    result = await db.execute(query)
    return [ClientRead.model_validate(r) for r in result.scalars().all()]


@router.post("", response_model=ClientRead, status_code=201)
async def create_client(
    body: ClientCreate,
    db: AsyncSession = Depends(get_db),
) -> ClientRead:
    client = Client(**body.model_dump())
    db.add(client)
    await db.commit()
    await db.refresh(client)
    logger.info("Created client id=%d name=%s", client.id, client.name)
    return ClientRead.model_validate(client)


@router.get("/{client_id}", response_model=ClientRead)
async def get_client(
    client_id: int,
    db: AsyncSession = Depends(get_db),
) -> ClientRead:
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(404, f"Client {client_id} not found.")
    return ClientRead.model_validate(client)


@router.put("/{client_id}", response_model=ClientRead)
async def update_client(
    client_id: int,
    body: ClientUpdate,
    db: AsyncSession = Depends(get_db),
) -> ClientRead:
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(404, f"Client {client_id} not found.")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(client, field, value)
    await db.commit()
    await db.refresh(client)
    return ClientRead.model_validate(client)


@router.delete("/{client_id}", status_code=204)
async def delete_client(
    client_id: int,
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(404, f"Client {client_id} not found.")
    await db.delete(client)
    await db.commit()
    logger.info("Deleted client id=%d", client_id)
