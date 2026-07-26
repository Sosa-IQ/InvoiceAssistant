import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.mark.parametrize(
    ("method", "path", "json"),
    [
        ("get", "/api/invoices", None),
        ("get", "/api/invoices/1/pdf", None),
        ("get", "/api/invoices/1/download", None),
        ("get", "/api/invoices/1/emails", None),
        ("post", "/api/invoices/1/send", {"subject": "Invoice", "message": "Attached."}),
        ("get", "/api/clients", None),
        ("put", "/api/clients/1/addresses/1", {"label": "Office", "address": "1 Main St"}),
        ("delete", "/api/clients/1/addresses/1", None),
    ],
)
def test_private_invoice_and_client_routes_require_authentication(
    method: str,
    path: str,
    json: dict[str, str] | None,
) -> None:
    client = TestClient(app)

    response = client.request(method, path, json=json)

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required."}
