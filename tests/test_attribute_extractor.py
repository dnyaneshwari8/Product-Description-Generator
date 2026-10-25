"""Unit tests for attribute extraction and text synthesis."""

import pytest
from PIL import Image

from backend.attribute_extractor import (
    extract_category,
    extract_dominant_color,
    extract_pattern,
    extract_shape_style,
    extract_visible_texture,
    generate_full_description,
    generate_key_features,
    generate_product_title,
    map_rgb_to_color_name,
    reconcile_color,
    build_product_analysis,
)
from backend.schemas import AttributeValue, VisualAttributes, ProductDescriptionResponse


def test_map_rgb_to_color_name():
    """Verify standard RGB mapping maps close colors accurately."""
    name, dist = map_rgb_to_color_name((25, 80, 185))
    assert "Blue" in name

    name, dist = map_rgb_to_color_name((190, 25, 40))
    assert "Red" in name

    name, dist = map_rgb_to_color_name((20, 20, 20))
    assert name == "Black"

    name, dist = map_rgb_to_color_name((245, 245, 245))
    assert name == "White"


def test_extract_dominant_color_synthetic_image():
    """Verify CV color extraction on synthetic image with white border and blue center."""
    img = Image.new("RGB", (100, 100), color=(255, 255, 255))
    # Draw blue center square
    for x in range(25, 75):
        for y in range(25, 75):
            img.putpixel((x, y), (20, 35, 75))

    attr = extract_dominant_color(img)
    assert "Blue" in attr.value
    assert attr.confidence in ("medium", "high")
    assert "image analysis" in attr.source


def test_extract_dominant_color_pure_red():
    """Verify color extraction on solid red image."""
    img = Image.new("RGB", (100, 100), color=(195, 30, 45))
    attr = extract_dominant_color(img)
    assert "Red" in attr.value


def test_reconcile_color_corroboration():
    """Verify that caption color upgrades confidence when CV and caption agree."""
    cv_color = AttributeValue(
        value="Navy Blue",
        confidence="medium",
        source="image analysis"
    )
    result = reconcile_color(cv_color, "a dark blue button-down shirt")
    assert "Blue" in result.value
    assert result.confidence == "high"

    # When CV is uncertain, caption provides fallback
    unc_color = AttributeValue(
        value="Not confidently detected",
        confidence="uncertain",
        source="image analysis"
    )
    result_fallback = reconcile_color(unc_color, "a red dress on a mannequin")
    assert "Red" in result_fallback.value
    assert result_fallback.confidence == "medium"


def test_extract_category():
    """Verify category heuristics for standard categories."""
    assert extract_category("a stylish running shoes on grass").value == "Footwear"
    assert extract_category("a black leather handbag on a table").value == "Bags"
    assert extract_category("a classic casual t-shirt hanging").value == "Clothing"
    assert extract_category("a minimalist wristwatch with leather strap").value == "Accessories"
    assert extract_category("a decorative ceramic vase").value == "Home"
    assert extract_category("wireless bluetooth headphones").value == "Electronics"
    assert extract_category("a tube of luxury lipstick").value == "Beauty"

    # User hint takes precedence
    user_cat = extract_category("a generic box", user_category="Footwear")
    assert user_cat.value == "Footwear"
    assert user_cat.source == "user-supplied hint"

    # Ambiguous caption without user hint
    ambiguous = extract_category("a random unknown item in a room")
    assert ambiguous.value == "Other"
    assert ambiguous.confidence == "uncertain"


def test_extract_shape_style():
    """Verify silhouette and shape detection."""
    assert "Collared" in extract_shape_style("a collared polo shirt").value
    assert "backpack" in extract_shape_style("a black backpack with two straps").value.lower()
    assert "Wrist-mounted" in extract_shape_style("a silver watch on a stand").value
    assert extract_shape_style("an abstract item").value == "Not confidently detected"


def test_extract_pattern():
    """Verify pattern heuristics."""
    assert "Striped" in extract_pattern("a blue striped dress").value
    assert "Floral" in extract_pattern("a floral summer dress").value
    assert "Checkered" in extract_pattern("a red plaid shirt").value
    # Default without pattern keywords
    assert "Solid" in extract_pattern("a plain black jacket").value


def test_extract_visible_texture_never_invents_materials():
    """
    Ensure the texture extractor strictly avoids claiming material composition
    like '100% cotton' or 'genuine leather'.
    """
    tex_denim = extract_visible_texture("a blue denim jacket")
    assert "denim weave" in tex_denim.value.lower()

    tex_knit = extract_visible_texture("a wool knit sweater")
    # Should detect the knit texture, not assert wool purity
    assert "knit" in tex_knit.value.lower()

    tex_uncertain = extract_visible_texture("a smooth shiny bag")
    assert tex_uncertain.value != "100% Genuine Leather"
    assert "material composition requires physical verification" in tex_uncertain.source


def test_generate_product_title():
    """Verify clean title generation."""
    attrs = VisualAttributes(
        category=AttributeValue(value="Clothing", confidence="medium", source="test"),
        main_color=AttributeValue(value="Navy Blue", confidence="medium", source="test"),
        shape_style=AttributeValue(value="Collared button-up", confidence="low", source="test"),
        pattern=AttributeValue(value="Solid", confidence="low", source="test"),
        visible_texture=AttributeValue(value="Not confidently detected", confidence="uncertain", source="test"),
    )
    title = generate_product_title(
        caption="a navy blue shirt on a table",
        visual_attributes=attrs,
        user_brand="Fabrik",
    )
    assert "Fabrik" in title
    assert "Blue" in title
    assert "Shirt" in title


def test_build_product_analysis_end_to_end():
    """Verify the entire synthesis pipeline produces a valid ProductDescriptionResponse."""
    img = Image.new("RGB", (100, 100), color=(30, 80, 190))
    caption = "a blue cotton t-shirt displayed on a white background"

    resp = build_product_analysis(
        image=img,
        caption=caption,
        user_title=None,
        user_brand="ShopTrend",
        user_category="Clothing",
    )

    assert isinstance(resp, ProductDescriptionResponse)
    assert resp.caption == caption
    assert "ShopTrend" in resp.product_title
    assert resp.visual_attributes.category.value == "Clothing"
    assert "Blue" in resp.visual_attributes.main_color.value
    assert len(resp.key_features) >= 3
    assert len(resp.full_description) > 50
    assert len(resp.uncertainty_notes) > 0
