"""Live end-to-end inference test with the real Salesforce BLIP model."""

import io
import os
import sys
import time

# Ensure workspace root is in path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image, ImageDraw
from backend.ai_service import ai_service


def test_real_blip_inference():
    """Performs real inference using the downloaded Salesforce BLIP model."""
    print("Testing real model load...")
    assert ai_service.load_model() is True
    assert ai_service.is_loaded is True

    # Generate a realistic test image: a dark blue shirt graphic on a light studio background
    width, height = 300, 300
    img = Image.new("RGB", (width, height), color=(240, 240, 245))
    draw = ImageDraw.Draw(img)

    # Draw body of shirt in dark navy blue
    draw.rectangle([90, 80, 210, 240], fill=(25, 45, 95))
    # Draw left sleeve
    draw.polygon([(90, 80), (40, 140), (60, 160), (90, 110)], fill=(25, 45, 95))
    # Draw right sleeve
    draw.polygon([(210, 80), (260, 140), (240, 160), (210, 110)], fill=(25, 45, 95))
    # Draw collar in lighter contrast
    draw.polygon([(120, 80), (150, 110), (180, 80), (150, 65)], fill=(210, 220, 240))
    # Draw buttons
    for y in [130, 160, 190]:
        draw.ellipse([147, y, 153, y + 6], fill=(255, 255, 255))

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    image_bytes = buf.getvalue()

    start_time = time.time()
    result = ai_service.analyze_product_image(
        image_bytes=image_bytes,
        user_title=None,
        user_brand="Fabrik Studio",
        user_category="Clothing"
    )
    duration = time.time() - start_time

    print(f"\nReal BLIP inference completed in {duration:.2f}s:")
    print(f"Caption: {result.caption}")
    print(f"Product Title: {result.product_title}")
    print(f"Main Color: {result.visual_attributes.main_color.value} ({result.visual_attributes.main_color.confidence})")
    print(f"Category: {result.visual_attributes.category.value} ({result.visual_attributes.category.source})")
    print(f"Shape/Style: {result.visual_attributes.shape_style.value}")
    print(f"Pattern: {result.visual_attributes.pattern.value}")
    print(f"Texture: {result.visual_attributes.visible_texture.value}")
    print(f"Description sample: {result.full_description[:120]}...")
    print(f"Key Features: {result.key_features}")

    assert result.caption and len(result.caption) > 0
    assert result.product_title and len(result.product_title) > 0
    assert "Blue" in result.visual_attributes.main_color.value or "Charcoal" in result.visual_attributes.main_color.value
    assert result.visual_attributes.category.value == "Clothing"
    assert len(result.key_features) >= 3
    print("\n[PASSED] Real BLIP inference test completed successfully!")


if __name__ == "__main__":
    test_real_blip_inference()
