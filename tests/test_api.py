"""Integration and API endpoint tests for ShopAI backend."""

import io
from PIL import Image
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.ai_service import ai_service


@pytest.fixture
def client():
    """Provides a TestClient for FastAPI."""
    return TestClient(app)


def test_health_endpoint(client):
    """GET /api/health returns 200 with required schema fields."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "model_loaded" in data
    assert "device" in data
    assert data["model_name"] == "Salesforce/blip-image-captioning-base"
    assert data["version"] == "1.0.0"


def test_generate_missing_image(client):
    """POST /api/generate-description without image fails with 422."""
    response = client.post("/api/generate-description", data={"title": "Test Shirt"})
    assert response.status_code == 422


def test_generate_unsupported_format(client):
    """POST /api/generate-description with non-image format returns 400."""
    files = {"image": ("document.pdf", b"%PDF-1.4 dummy", "application/pdf")}
    response = client.post("/api/generate-description", files=files)
    assert response.status_code == 400
    assert "Unsupported image format" in response.json()["detail"]


def test_generate_empty_image(client):
    """POST /api/generate-description with empty file returns 400."""
    files = {"image": ("empty.jpg", b"", "image/jpeg")}
    response = client.post("/api/generate-description", files=files)
    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()


def test_generate_corrupt_image(client):
    """POST /api/generate-description with corrupt bytes returns 400."""
    files = {"image": ("broken.png", b"\x89PNG\r\n\x1a\nCorruptRandomBytes", "image/png")}
    response = client.post("/api/generate-description", files=files)
    assert response.status_code == 400
    assert "corrupted" in response.json()["detail"].lower() or "invalid" in response.json()["detail"].lower()


def test_generate_oversized_image(client):
    """POST /api/generate-description with oversized file (>10MB) returns 413."""
    # 10.5 MB of fake image data
    oversized_bytes = b"0" * (10 * 1024 * 1024 + 500 * 1024)
    files = {"image": ("huge.jpg", oversized_bytes, "image/jpeg")}
    response = client.post("/api/generate-description", files=files)
    assert response.status_code == 413
    assert "exceeds" in response.json()["detail"].lower()


def test_generate_with_mocked_caption(client, monkeypatch):
    """
    Test successful generation flow and response schema contract
    by ensuring model is ready and captioning returns predictable test caption.
    """
    # Create valid synthetic JPEG
    img_byte_arr = io.BytesIO()
    test_img = Image.new("RGB", (80, 80), color=(20, 35, 75))
    test_img.save(img_byte_arr, format="JPEG")
    jpeg_bytes = img_byte_arr.getvalue()

    # Ensure model is marked loaded and generate_caption returns predictable text
    monkeypatch.setattr(ai_service, "is_loaded", True)
    monkeypatch.setattr(
        ai_service,
        "generate_caption",
        lambda img: "a dark blue button-down shirt on display"
    )

    files = {"image": ("blue_shirt.jpg", jpeg_bytes, "image/jpeg")}
    data = {
        "brand": "IndieCraft",
        "category": "Clothing",
    }
    response = client.post("/api/generate-description", files=files, data=data)
    assert response.status_code == 200

    result = response.json()
    # Verify response schema contract
    assert "caption" in result
    assert "product_title" in result
    assert "visual_attributes" in result
    assert "full_description" in result
    assert "key_features" in result
    assert "uncertainty_notes" in result

    # Check visual attributes details
    attrs = result["visual_attributes"]
    assert "category" in attrs
    assert "main_color" in attrs
    assert "shape_style" in attrs
    assert "pattern" in attrs
    assert "visible_texture" in attrs

    assert attrs["category"]["value"] == "Clothing"
    assert "Blue" in attrs["main_color"]["value"]
    assert isinstance(result["key_features"], list)
    assert len(result["key_features"]) > 0
