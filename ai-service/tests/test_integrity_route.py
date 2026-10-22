import io
from PIL import Image

from fastapi.testclient import TestClient

from app.main import app
from app.routers import integrity
from app.services.cv_pipeline import CVUnavailable


client = TestClient(app)


def _jpeg_bytes():
    stream = io.BytesIO()
    Image.new("RGB", (16, 16), color="white").save(stream, format="JPEG")
    return stream.getvalue()


def test_frame_analysis_accepts_image_and_uses_in_memory_pipeline(monkeypatch):
    monkeypatch.setattr(
        integrity,
        "analyze_frame",
        lambda _data: {"faceCount": 1, "phoneDetected": False, "confidence": 0.0},
    )
    response = client.post("/ai/integrity/analyze-frame", files={"file": ("frame.jpg", _jpeg_bytes(), "image/jpeg")})
    assert response.status_code == 200
    assert response.json()["faceCount"] == 1


def test_frame_analysis_rejects_unsupported_type_and_oversize_payload():
    wrong_type = client.post("/ai/integrity/analyze-frame", files={"file": ("frame.gif", b"gif", "image/gif")})
    assert wrong_type.status_code == 400

    too_large = client.post(
        "/ai/integrity/analyze-frame",
        files={"file": ("frame.jpg", io.BytesIO(b"x" * (integrity.MAX_FRAME_BYTES + 1)), "image/jpeg")},
    )
    assert too_large.status_code == 413


def test_frame_analysis_reports_unavailable_cv_as_service_error(monkeypatch):
    def unavailable(_data):
        raise CVUnavailable("optional computer-vision models unavailable")

    monkeypatch.setattr(integrity, "analyze_frame", unavailable)
    response = client.post("/ai/integrity/analyze-frame", files={"file": ("frame.jpg", _jpeg_bytes(), "image/jpeg")})
    assert response.status_code == 503


def test_frame_analysis_rejects_fake_image_bytes_even_with_image_mime():
    response = client.post(
        "/ai/integrity/analyze-frame",
        files={"file": ("frame.jpg", b"not really an image", "image/jpeg")},
    )
    assert response.status_code == 422
