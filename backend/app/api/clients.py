import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.db_models import Client, ClientAddress
from app.models.schemas import (
    ClientAddressCreate,
    ClientAddressRead,
    ClientCreate,
    ClientRead,
    ClientUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/clients", tags=["clients"])


def _with_addresses():
    return selectinload(Client.addresses)


@router.get("", response_model=list[ClientRead])
async def list_clients(
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[ClientRead]:
    """Return all clients with their addresses, optionally filtered by name."""
    query = select(Client).options(_with_addresses()).order_by(Client.name)
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
    result = await db.execute(
        select(Client).options(_with_addresses()).where(Client.id == client.id)
    )
    client = result.scalar_one()
    logger.info("Created client id=%d name=%s", client.id, client.name)
    return ClientRead.model_validate(client)


@router.get("/{client_id}", response_model=ClientRead)
async def get_client(
    client_id: int,
    db: AsyncSession = Depends(get_db),
) -> ClientRead:
    result = await db.execute(
        select(Client).options(_with_addresses()).where(Client.id == client_id)
    )
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
    result = await db.execute(
        select(Client).options(_with_addresses()).where(Client.id == client_id)
    )
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(404, f"Client {client_id} not found.")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(client, field, value)
    await db.commit()
    result = await db.execute(
        select(Client).options(_with_addresses()).where(Client.id == client_id)
    )
    client = result.scalar_one()
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


# ---------------------------------------------------------------------------
# Address sub-resource
# ---------------------------------------------------------------------------

@router.post("/{client_id}/addresses", response_model=ClientAddressRead, status_code=201)
async def add_client_address(
    client_id: int,
    body: ClientAddressCreate,
    db: AsyncSession = Depends(get_db),
) -> ClientAddressRead:
    result = await db.execute(select(Client).where(Client.id == client_id))
    if not result.scalar_one_or_none():
        raise HTTPException(404, f"Client {client_id} not found.")
    addr = ClientAddress(client_id=client_id, **body.model_dump())
    db.add(addr)
    await db.commit()
    await db.refresh(addr)
    logger.info("Added address id=%d to client id=%d", addr.id, client_id)
    return ClientAddressRead.model_validate(addr)


@router.put("/{client_id}/addresses/{address_id}", response_model=ClientAddressRead)
async def update_client_address(
    client_id: int,
    address_id: int,
    body: ClientAddressCreate,
    db: AsyncSession = Depends(get_db),
) -> ClientAddressRead:
    result = await db.execute(
        select(ClientAddress).where(
            ClientAddress.id == address_id, ClientAddress.client_id == client_id
        )
    )
    addr = result.scalar_one_or_none()
    if not addr:
        raise HTTPException(404, f"Address {address_id} not found for client {client_id}.")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(addr, field, value)
    await db.commit()
    await db.refresh(addr)
    return ClientAddressRead.model_validate(addr)


@router.delete("/{client_id}/addresses/{address_id}", status_code=204)
async def delete_client_address(
    client_id: int,
    address_id: int,
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        select(ClientAddress).where(
            ClientAddress.id == address_id, ClientAddress.client_id == client_id
        )
    )
    addr = result.scalar_one_or_none()
    if not addr:
        raise HTTPException(404, f"Address {address_id} not found for client {client_id}.")
    await db.delete(addr)
    await db.commit()
    logger.info("Deleted address id=%d from client id=%d", address_id, client_id)
