from fastapi.testclient import TestClient

from app import main
from app.main import app


client = TestClient(app)


def test_health() -> None:
    assert client.get("/api/health").json() == {"status": "ok"}


def test_rejects_non_pdf() -> None:
    response = client.post(
        "/api/v1/reports/analyze",
        files={"file": ("report.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 415


def test_shared_access_code(monkeypatch) -> None:
    monkeypatch.setenv("APP_ACCESS_CODE", "demo-secret")
    response = client.post(
        "/api/v1/reports/analyze",
        files={"file": ("report.pdf", b"not-a-pdf", "application/pdf")},
    )
    assert response.status_code == 401


def test_rejects_pdf_over_size_limit(monkeypatch) -> None:
    monkeypatch.setattr(main, "MAX_PDF_SIZE", 4)
    response = client.post(
        "/api/v1/reports/analyze",
        files={"file": ("report.pdf", b"12345", "application/pdf")},
    )
    assert response.status_code == 413
    assert response.json()["detail"] == "PDF превышает лимит 50 МБ"
