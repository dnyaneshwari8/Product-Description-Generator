"""Attribute extractor for ShopAI.

Extracts visual attributes, title, marketing description, and key features
using a combination of:
1. Deterministic computer vision (Pillow RGB/HSV dominant color analysis)
2. Semantic heuristics from Salesforce BLIP caption
3. Optional user hints (brand, title, category)

IMPORTANT:
This module does NOT invent hidden properties (e.g., fabric composition,
waterproof ratings, exact dimensions, or certifications). Uncertain
attributes are honestly flagged as 'Not confidently detected' or 'Uncertain'.
"""

import math
from typing import Dict, List, Optional, Tuple
from PIL import Image

from backend.schemas import (
    AttributeValue,
    VisualAttributes,
    ProductDescriptionResponse,
)

# Reference color palette for deterministic RGB mapping
REFERENCE_COLORS: Dict[str, Tuple[int, int, int]] = {
    "Black": (20, 20, 20),
    "White": (245, 245, 245),
    "Dark Charcoal": (50, 50, 50),
    "Light Grey": (190, 190, 190),
    "Navy Blue": (20, 35, 75),
    "Royal Blue": (30, 80, 190),
    "Sky Blue": (120, 185, 240),
    "Teal / Turquoise": (25, 140, 145),
    "Forest Green": (25, 75, 40),
    "Olive Green": (90, 105, 45),
    "Mint Green": (150, 220, 180),
    "Emerald Green": (35, 145, 75),
    "Burgundy / Maroon": (110, 20, 40),
    "Crimson Red": (195, 30, 45),
    "Coral Pink": (235, 100, 110),
    "Blush Pink": (240, 180, 195),
    "Mustard Yellow": (215, 165, 30),
    "Bright Yellow": (250, 225, 40),
    "Terracotta / Rust": (175, 70, 40),
    "Chocolate Brown": (80, 45, 25),
    "Tan / Camel": (180, 135, 90),
    "Beige / Cream": (230, 220, 195),
    "Deep Purple": (80, 30, 105),
    "Lavender / Lilac": (185, 160, 215),
    "Bright Orange": (240, 110, 25),
}

# Color keywords commonly found in BLIP captions
CAPTION_COLOR_MAP = {
    "black": "Black",
    "white": "White",
    "dark blue": "Navy Blue",
    "navy": "Navy Blue",
    "blue": "Royal Blue",
    "light blue": "Sky Blue",
    "red": "Crimson Red",
    "dark red": "Burgundy / Maroon",
    "maroon": "Burgundy / Maroon",
    "burgundy": "Burgundy / Maroon",
    "pink": "Coral Pink",
    "green": "Forest Green",
    "dark green": "Forest Green",
    "olive": "Olive Green",
    "yellow": "Bright Yellow",
    "mustard": "Mustard Yellow",
    "brown": "Chocolate Brown",
    "tan": "Tan / Camel",
    "beige": "Beige / Cream",
    "cream": "Beige / Cream",
    "grey": "Light Grey",
    "gray": "Light Grey",
    "purple": "Deep Purple",
    "violet": "Deep Purple",
    "orange": "Bright Orange",
    "gold": "Mustard Yellow",
    "silver": "Light Grey",
    "turquoise": "Teal / Turquoise",
    "teal": "Teal / Turquoise",
}

# Category keyword heuristics
CATEGORY_KEYWORDS = {
    "Clothing": [
        "shirt", "t-shirt", "tee", "dress", "jacket", "pants", "trousers", "jeans",
        "skirt", "sweater", "hoodie", "coat", "blazer", "top", "blouse", "suit",
        "shorts", "cardigan", "vest", "sweatshirt", "denim jacket", "polo"
    ],
    "Footwear": [
        "shoe", "shoes", "sneaker", "sneakers", "boot", "boots", "sandal", "sandals",
        "heel", "heels", "loafer", "loafers", "slipper", "slippers", "footwear",
        "cleat", "cleats", "trainer", "trainers"
    ],
    "Bags": [
        "bag", "handbag", "backpack", "tote", "clutch", "purse", "satchel",
        "duffel", "luggage", "suitcase", "crossbody", "briefcase", "knapsack"
    ],
    "Accessories": [
        "watch", "wristwatch", "sunglasses", "glasses", "scarf", "belt", "hat",
        "cap", "tie", "necklace", "bracelet", "ring", "earring", "earrings",
        "wallet", "jewelry", "beanie", "bandana", "gloves"
    ],
    "Home": [
        "pillow", "cushion", "blanket", "rug", "lamp", "vase", "chair", "table",
        "mug", "cup", "candle", "towel", "bedding", "decor", "sofa", "pot",
        "planter", "clock", "curtain"
    ],
    "Electronics": [
        "phone", "laptop", "headphones", "headset", "earphones", "earbuds",
        "smartwatch", "speaker", "camera", "tablet", "charger", "mouse",
        "keyboard", "display", "monitor"
    ],
    "Beauty": [
        "lipstick", "perfume", "lotion", "cream", "serum", "shampoo",
        "cosmetics", "makeup", "skincare", "mascara", "foundation", "fragrance"
    ],
}

# Shape and silhouette patterns
SHAPE_PATTERNS = [
    ("collared", "Collared button-up silhouette"),
    ("button-down", "Button-down structured design"),
    ("polo", "Polo collar silhouette"),
    ("crew neck", "Classic crew neckline"),
    ("v-neck", "V-neck silhouette"),
    ("hooded", "Hooded design with relaxed cut"),
    ("high top", "High-top ankle profile"),
    ("low top", "Low-top streamlined profile"),
    ("slip on", "Slip-on laceless silhouette"),
    ("tote", "Structured tote with dual handles"),
    ("backpack", "Ergonomic backpack with shoulder straps"),
    ("crossbody", "Crossbody silhouette with adjustable strap"),
    ("clutch", "Compact handheld clutch design"),
    ("wristwatch", "Analog round dial with band"),
    ("watch", "Wrist-mounted profile"),
    ("running shoes", "Athletic running silhouette with contoured sole"),
    ("sneakers", "Casual sneaker silhouette"),
    ("sunglasses", "Eyewear frame design"),
    ("scarf", "Draped rectangular wrap"),
    ("dress", "Flowing dress silhouette"),
    ("jacket", "Structured outerwear silhouette"),
    ("long sleeve", "Full-length sleeve profile"),
    ("short sleeve", "Short sleeve profile"),
    ("sleeveless", "Sleeveless profile"),
]

# Pattern keywords
PATTERN_KEYWORDS = [
    ("striped", "Striped pattern"),
    ("stripes", "Striped pattern"),
    ("floral", "Floral pattern"),
    ("flowers", "Floral pattern"),
    ("plaid", "Plaid / Checkered pattern"),
    ("checkered", "Checkered pattern"),
    ("checks", "Checkered pattern"),
    ("polka dot", "Polka dot pattern"),
    ("dots", "Dotted pattern"),
    ("graphic", "Graphic printed visual"),
    ("print", "Printed graphic visual"),
    ("printed", "Printed visual pattern"),
    ("camo", "Camouflage pattern"),
    ("tie-dye", "Tie-dye pattern"),
    ("solid", "Solid / Plain finish"),
]

# Visible texture keywords (strictly observable, not material composition)
TEXTURE_KEYWORDS = [
    ("denim", "Visible denim weave texture"),
    ("knit", "Knitted texture"),
    ("knitted", "Knitted texture"),
    ("ribbed", "Ribbed surface texture"),
    ("woven", "Woven surface appearance"),
    ("quilted", "Quilted padded texture"),
    ("mesh", "Breathable mesh texture"),
    ("canvas", "Canvas-like matte texture"),
    ("textured", "Visible surface texture"),
    ("glossy", "Glossy reflective surface"),
    ("matte", "Smooth matte finish"),
    ("perforated", "Perforated surface finish"),
]


def rgb_distance(c1: Tuple[int, int, int], c2: Tuple[int, int, int]) -> float:
    """Calculates weighted Euclidean distance between two RGB colors."""
    r1, g1, b1 = c1
    r2, g2, b2 = c2
    # Perceptually weighted Euclidean formula
    rmean = (r1 + r2) / 2.0
    dr = r1 - r2
    dg = g1 - g2
    db = b1 - b2
    return math.sqrt((2 + rmean / 256.0) * (dr ** 2) + 4.0 * (dg ** 2) + (2 + (255 - rmean) / 256.0) * (db ** 2))


def map_rgb_to_color_name(rgb: Tuple[int, int, int]) -> Tuple[str, float]:
    """Finds the closest reference color and returns the name and distance."""
    best_name = "Uncertain"
    best_dist = float("inf")
    for name, ref_rgb in REFERENCE_COLORS.items():
        dist = rgb_distance(rgb, ref_rgb)
        if dist < best_dist:
            best_dist = dist
            best_name = name
    return best_name, best_dist


def extract_dominant_color(image: Image.Image) -> AttributeValue:
    """
    Deterministically estimates the dominant visible color of the product
    using Pillow image processing.

    Strategy:
    1. Downsample image to 100x100 for fast, consistent analysis.
    2. Sample the outer perimeter (background probe).
    3. Filter out pixels matching the background color or transparent pixels.
    4. Group remaining foreground pixels and find the primary color cluster.
    5. Fallback gracefully if background and foreground cannot be separated.
    """
    try:
        # Convert to RGB (or RGBA to handle alpha)
        has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
        img_work = image.convert("RGBA") if has_alpha else image.convert("RGB")
        img_small = img_work.resize((100, 100), Image.Resampling.BOX)

        pixels = list(img_small.getdata())
        width, height = img_small.size

        # 1. Identify background candidate by sampling borders (top, bottom, left, right edges)
        border_pixels: List[Tuple[int, int, int]] = []
        for x in range(width):
            for y in (0, 1, height - 2, height - 1):
                px = pixels[y * width + x]
                if len(px) == 4 and px[3] < 128:
                    continue
                border_pixels.append((px[0], px[1], px[2]))

        for y in range(height):
            for x in (0, 1, width - 2, width - 1):
                px = pixels[y * width + x]
                if len(px) == 4 and px[3] < 128:
                    continue
                border_pixels.append((px[0], px[1], px[2]))

        # Calculate average background color if border pixels exist
        bg_rgb: Optional[Tuple[int, int, int]] = None
        if border_pixels:
            avg_r = int(sum(p[0] for p in border_pixels) / len(border_pixels))
            avg_g = int(sum(p[1] for p in border_pixels) / len(border_pixels))
            avg_b = int(sum(p[2] for p in border_pixels) / len(border_pixels))
            bg_rgb = (avg_r, avg_g, avg_b)

        # 2. Extract foreground pixels (excluding alpha and pixels near bg_rgb)
        fg_pixels: List[Tuple[int, int, int]] = []
        for px in pixels:
            if len(px) == 4 and px[3] < 128:
                continue  # skip transparent
            rgb = (px[0], px[1], px[2])
            if bg_rgb is not None:
                # If pixel is too close to border background color, skip it
                if rgb_distance(rgb, bg_rgb) < 55.0:
                    continue
            fg_pixels.append(rgb)

        # If too few foreground pixels remained (e.g. image is solid background or subject blends in)
        if len(fg_pixels) < 150:
            # Fall back to using non-pure-white/black pixels or all pixels
            all_valid = [
                (p[0], p[1], p[2]) for p in pixels
                if not (len(p) == 4 and p[3] < 128)
            ]
            if not all_valid:
                return AttributeValue(
                    value="Not confidently detected",
                    confidence="uncertain",
                    source="image analysis (insufficient foreground pixels)"
                )
            fg_pixels = all_valid

        # Quantize colors into small bins (step of 32) to find the mode / dominant bucket
        bins: Dict[Tuple[int, int, int], List[Tuple[int, int, int]]] = {}
        for r, g, b in fg_pixels:
            bin_key = (r // 32 * 32, g // 32 * 32, b // 32 * 32)
            if bin_key not in bins:
                bins[bin_key] = []
            bins[bin_key].append((r, g, b))

        # Find largest bin
        largest_bin_key = max(bins.keys(), key=lambda k: len(bins[k]))
        dominant_cluster = bins[largest_bin_key]

        avg_r = int(sum(p[0] for p in dominant_cluster) / len(dominant_cluster))
        avg_g = int(sum(p[1] for p in dominant_cluster) / len(dominant_cluster))
        avg_b = int(sum(p[2] for p in dominant_cluster) / len(dominant_cluster))
        dominant_rgb = (avg_r, avg_g, avg_b)

        color_name, dist = map_rgb_to_color_name(dominant_rgb)

        confidence = "medium" if dist < 120 else "low"
        return AttributeValue(
            value=color_name,
            confidence=confidence,
            source="image analysis (pixel color segmentation)"
        )
    except Exception:
        return AttributeValue(
            value="Not confidently detected",
            confidence="uncertain",
            source="image analysis (error)"
        )


def reconcile_color(cv_color: AttributeValue, caption: str) -> AttributeValue:
    """
    Checks if caption mentions a specific color that corroborates or refines
    the computer vision color estimate.
    """
    caption_lower = caption.lower()
    for phrase, mapped_color in CAPTION_COLOR_MAP.items():
        if f" {phrase} " in f" {caption_lower} ":
            # If CV also detected something similar or was uncertain, upgrade confidence
            if cv_color.value.lower() in mapped_color.lower() or mapped_color.lower() in cv_color.value.lower():
                return AttributeValue(
                    value=mapped_color,
                    confidence="high",
                    source="corroborated by image analysis & caption"
                )
            elif cv_color.confidence == "uncertain":
                return AttributeValue(
                    value=mapped_color,
                    confidence="medium",
                    source="caption keyword heuristic"
                )
    return cv_color


def extract_category(caption: str, user_category: Optional[str] = None) -> AttributeValue:
    """
    Determines category using user hint if provided, otherwise BLIP caption heuristics.
    """
    if user_category and user_category.strip() and user_category.strip().lower() != "other":
        clean_user_cat = user_category.strip()
        return AttributeValue(
            value=clean_user_cat,
            confidence="medium",
            source="user-supplied hint"
        )

    caption_lower = caption.lower()
    # Search in priority order of specific categories
    for cat, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if f" {kw} " in f" {caption_lower} " or caption_lower.startswith(f"{kw} ") or caption_lower.endswith(f" {kw}"):
                return AttributeValue(
                    value=cat,
                    confidence="medium",
                    source=f"caption keyword ('{kw}')"
                )

    if user_category and user_category.strip().lower() == "other":
        return AttributeValue(
            value="Other",
            confidence="low",
            source="user selection"
        )

    return AttributeValue(
        value="Other",
        confidence="uncertain",
        source="caption heuristic (no matching keyword)"
    )


def extract_shape_style(caption: str) -> AttributeValue:
    """Extracts observable shape or style silhouette from the caption."""
    caption_lower = caption.lower()
    for pattern, description in SHAPE_PATTERNS:
        if pattern in caption_lower:
            return AttributeValue(
                value=description,
                confidence="low",
                source=f"caption heuristic ('{pattern}')"
            )

    return AttributeValue(
        value="Not confidently detected",
        confidence="uncertain",
        source="heuristic (insufficient visual cue)"
    )


def extract_pattern(caption: str) -> AttributeValue:
    """Extracts visual pattern from caption heuristics."""
    caption_lower = caption.lower()
    for kw, description in PATTERN_KEYWORDS:
        if f" {kw} " in f" {caption_lower} " or caption_lower.startswith(f"{kw} ") or caption_lower.endswith(f" {kw}"):
            return AttributeValue(
                value=description,
                confidence="low",
                source=f"caption heuristic ('{kw}')"
            )

    # If neither pattern keywords nor obvious print hints are present:
    return AttributeValue(
        value="Solid / Plain",
        confidence="low",
        source="heuristic default (no pattern detected)"
    )


def extract_visible_texture(caption: str) -> AttributeValue:
    """
    Extracts visible surface texture from caption.
    Strictly avoids claiming hidden material properties like '100% cotton'.
    """
    caption_lower = caption.lower()
    for kw, description in TEXTURE_KEYWORDS:
        if kw in caption_lower:
            return AttributeValue(
                value=description,
                confidence="low",
                source=f"caption heuristic ('{kw}')"
            )

    return AttributeValue(
        value="Not confidently detected",
        confidence="uncertain",
        source="heuristic (material composition requires physical verification)"
    )


def generate_product_title(
    caption: str,
    visual_attributes: VisualAttributes,
    user_title: Optional[str] = None,
    user_brand: Optional[str] = None,
) -> str:
    """
    Proposes a clean, professional product title based on user inputs,
    observable color, shape, and category.
    """
    if user_title and user_title.strip():
        # Keep user title, but if brand is provided and not in title, prepend it
        title = user_title.strip()
        if user_brand and user_brand.strip() and user_brand.strip().lower() not in title.lower():
            return f"{user_brand.strip()} {title}"
        return title

    brand_prefix = f"{user_brand.strip()} " if user_brand and user_brand.strip() else ""
    color_val = visual_attributes.main_color.value
    category_val = visual_attributes.category.value

    # Filter out uncertain color
    color_term = ""
    if color_val and color_val not in ("Not confidently detected", "Uncertain"):
        color_term = f"{color_val} "

    # Clean silhouette or category name
    item_type = category_val if category_val != "Other" else "Product"
    caption_lower = caption.lower()

    # Look for a specific noun from the caption
    for kw_list in CATEGORY_KEYWORDS.values():
        for kw in kw_list:
            if kw in caption_lower:
                item_type = kw.title()
                break
        if item_type != (category_val if category_val != "Other" else "Product"):
            break

    # E.g. "Brand Navy Blue Shirt" or "Everyday Classic Navy Blue Shirt"
    style_term = "Classic " if not brand_prefix else ""
    title = f"{brand_prefix}{style_term}{color_term}{item_type}".strip()
    return title


def generate_full_description(
    title: str,
    caption: str,
    visual_attributes: VisualAttributes,
    user_brand: Optional[str] = None,
) -> str:
    """
    Generates a natural, professional Shopify product description grounded strictly
    in observable visual details and verified inputs.
    Avoids unobservable material and performance claims.
    """
    brand_mention = f"by {user_brand.strip()}" if user_brand and user_brand.strip() else ""
    color_val = visual_attributes.main_color.value
    shape_val = visual_attributes.shape_style.value
    pattern_val = visual_attributes.pattern.value
    category_val = visual_attributes.category.value

    # Build description parts
    p1 = f"Presenting the {title}{' ' + brand_mention if brand_mention else ''}, thoughtfully designed for everyday appeal and contemporary style."

    details = []
    if color_val not in ("Not confidently detected", "Uncertain"):
        details.append(f"featuring a prominent {color_val.lower()} visual finish")
    if shape_val != "Not confidently detected":
        details.append(f"highlighted by a {shape_val.lower()}")
    if pattern_val not in ("Not confidently detected", "Solid / Plain"):
        details.append(f"complemented by an eye-catching {pattern_val.lower()}")
    elif pattern_val == "Solid / Plain":
        details.append("designed with a clean, solid exterior")

    if details:
        p2 = f"This piece is visible in the studio presentation {', '.join(details)}. Its versatile silhouette pairs effortlessly across various looks, making it a reliable addition to your catalog."
    else:
        p2 = "Its clean visual presentation offers a versatile silhouette that easily integrates with contemporary wardrobes and lifestyle setups."

    p3 = "Please note: Fabric composition, exact measurements, and care instructions should be verified and customized according to your physical inventory before publishing."

    return f"{p1}\n\n{p2}\n\n{p3}"


def generate_key_features(
    visual_attributes: VisualAttributes,
    user_brand: Optional[str] = None,
) -> List[str]:
    """Generates structured bullet points grounded in visible attributes."""
    features: List[str] = []

    if user_brand and user_brand.strip():
        features.append(f"Brand: {user_brand.strip()}")

    category_val = visual_attributes.category.value
    if category_val != "Other":
        features.append(f"Category: {category_val}")

    color_val = visual_attributes.main_color.value
    if color_val not in ("Not confidently detected", "Uncertain"):
        features.append(f"Dominant Visible Color: {color_val}")
    else:
        features.append("Dominant Color: Verify with physical sample")

    shape_val = visual_attributes.shape_style.value
    if shape_val != "Not confidently detected":
        features.append(f"Silhouette & Profile: {shape_val}")

    pattern_val = visual_attributes.pattern.value
    if pattern_val != "Not confidently detected":
        features.append(f"Visual Pattern: {pattern_val}")

    texture_val = visual_attributes.visible_texture.value
    if texture_val != "Not confidently detected":
        features.append(f"Surface Texture: {texture_val}")

    features.append("Merchant Notice: Confirm exact material composition and care specs prior to listing")

    return features


def build_product_analysis(
    image: Image.Image,
    caption: str,
    user_title: Optional[str] = None,
    user_brand: Optional[str] = None,
    user_category: Optional[str] = None,
) -> ProductDescriptionResponse:
    """
    End-to-end extraction pipeline taking an image, BLIP caption, and optional user fields.
    Returns fully validated ProductDescriptionResponse.
    """
    # 1. Deterministic CV color extraction + caption corroboration
    raw_color = extract_dominant_color(image)
    reconciled_color = reconcile_color(raw_color, caption)

    # 2. Heuristic extraction from caption + user hints
    cat_attr = extract_category(caption, user_category)
    shape_attr = extract_shape_style(caption)
    pattern_attr = extract_pattern(caption)
    texture_attr = extract_visible_texture(caption)

    visual_attributes = VisualAttributes(
        category=cat_attr,
        main_color=reconciled_color,
        shape_style=shape_attr,
        pattern=pattern_attr,
        visible_texture=texture_attr,
    )

    # 3. Product title synthesis
    title = generate_product_title(
        caption=caption,
        visual_attributes=visual_attributes,
        user_title=user_title,
        user_brand=user_brand,
    )

    # 4. Description synthesis
    description = generate_full_description(
        title=title,
        caption=caption,
        visual_attributes=visual_attributes,
        user_brand=user_brand,
    )

    # 5. Key features synthesis
    features = generate_key_features(
        visual_attributes=visual_attributes,
        user_brand=user_brand,
    )

    # 6. Uncertainty notes
    uncertainty_notes = [
        "AI visual attributes are heuristic estimates based on visible image features.",
        "Verify material composition, sizing, and physical details before publishing."
    ]

    return ProductDescriptionResponse(
        caption=caption,
        product_title=title,
        visual_attributes=visual_attributes,
        full_description=description,
        key_features=features,
        uncertainty_notes=uncertainty_notes,
    )
