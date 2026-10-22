import pytest
from starlette.testclient import TestClient
from app.core.config import get_settings


@pytest.fixture(autouse=True)
def inject_internal_service_secret(monkeypatch):
    settings = get_settings()
    original_request = TestClient.request

    def wrapped_request(self, method, url, *args, **kwargs):
        headers = dict(kwargs.get("headers") or {})
        # If test explicitly asks to skip injection, don't supply the secret
        if "X-Skip-Secret-Inject" in headers:
            headers.pop("X-Skip-Secret-Inject")
        elif "X-Internal-Secret" not in headers:
            headers["X-Internal-Secret"] = settings.INTERNAL_SERVICE_KEY
        kwargs["headers"] = headers
        return original_request(self, method, url, *args, **kwargs)

    monkeypatch.setattr(TestClient, "request", wrapped_request)

