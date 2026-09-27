"""Per-user scoping of the local PDF cache in StorageService (no database needed)."""

from __future__ import annotations

import pytest

from app.config import settings
from app.services.storage import StorageService

ALICE = "11111111-1111-1111-1111-111111111111"
BOB = "22222222-2222-2222-2222-222222222222"


@pytest.fixture
def storage(monkeypatch, tmp_path) -> StorageService:
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    # Never reach Supabase from a unit test; this forces the local-only path.
    monkeypatch.setattr(settings, "supabase_service_role_key", "")
    return StorageService()


async def test_same_invoice_number_writes_separate_files(storage) -> None:
    alice_path, _ = await storage.save_generated_pdf(ALICE, "INV-ACME_01", b"alice pdf")
    bob_path, _ = await storage.save_generated_pdf(BOB, "INV-ACME_01", b"bob pdf")

    assert alice_path != bob_path
    assert alice_path.read_bytes() == b"alice pdf"
    assert bob_path.read_bytes() == b"bob pdf"
    assert alice_path.parent == settings.invoices_dir / ALICE


def test_ownership_is_limited_to_the_users_folder(storage) -> None:
    alice_file = storage.get_user_dir(ALICE) / "INV-ACME_01.pdf"
    legacy_flat_file = settings.invoices_dir / "INV-ACME_01.pdf"

    assert storage.is_user_local_path(ALICE, str(alice_file))
    assert not storage.is_user_local_path(BOB, str(alice_file))
    # Pre-scoping records point at the shared flat folder and may belong to anyone.
    assert not storage.is_user_local_path(ALICE, str(legacy_flat_file))
    assert not storage.is_user_local_path(ALICE, str(storage.get_user_dir(ALICE) / ".." / BOB / "x.pdf"))
    assert not storage.is_user_local_path(ALICE, None)


def test_non_uuid_user_id_is_rejected(storage) -> None:
    with pytest.raises(ValueError):
        storage.get_user_dir("../../etc")
