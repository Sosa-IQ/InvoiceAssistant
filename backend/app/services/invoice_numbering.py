import re

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import Client, InvoiceRecord

_CLIENT_CODE_RE = re.compile(r"[A-Z0-9]+")


def _base_client_code(name: str) -> str:
    parts = _CLIENT_CODE_RE.findall(name.upper())
    if not parts:
        return "CLIENT"
    return "".join(parts)[:8] or "CLIENT"


async def ensure_client_code(db: AsyncSession, client: Client) -> str:
    if client.client_code:
        return client.client_code

    base_code = _base_client_code(client.name)
    suffix = 1

    while True:
        candidate = base_code if suffix == 1 else f"{base_code}{suffix}"
        result = await db.execute(
            select(Client.id).where(
                Client.user_id == client.user_id,
                Client.client_code == candidate,
                Client.id != client.id,
            )
        )
        if result.scalar_one_or_none() is None:
            client.client_code = candidate
            await db.flush()
            return candidate
        suffix += 1


async def next_client_invoice_sequence(
    db: AsyncSession,
    user_id: str,
    client_id: int,
) -> int:
    result = await db.execute(
        select(func.max(InvoiceRecord.client_invoice_sequence)).where(
            InvoiceRecord.user_id == user_id,
            InvoiceRecord.client_id == client_id,
        )
    )
    current = result.scalar_one_or_none()
    return (current or 0) + 1


def format_invoice_number(client_code: str, sequence: int) -> str:
    return f"INV-{client_code}_{sequence:02d}"
