from fastapi.testclient import TestClient
from app.main import app
from app.core.config import get_settings


def test_rejects_ai_endpoint_without_internal_secret():
    client = TestClient(app)
    # Calling /ai/github/octocat/analyze without the internal secret
    response = client.get("/ai/github/octocat/analyze", headers={"X-Skip-Secret-Inject": "true"})
    assert response.status_code == 403
    assert "Forbidden" in response.json().get("detail", "")


def test_rejects_ai_endpoint_with_invalid_internal_secret():
    client = TestClient(app)
    response = client.get(
        "/ai/github/octocat/analyze",
        headers={"X-Internal-Secret": "invalid-wrong-secret"}
    )
    assert response.status_code == 403
    assert "Forbidden" in response.json().get("detail", "")


def test_allows_public_root_without_internal_secret():
    client = TestClient(app)
    response = client.get("/", headers={"X-Skip-Secret-Inject": "true"})
    assert response.status_code == 200
    assert "Hirelens AI Service Running" in response.json().get("message", "")

