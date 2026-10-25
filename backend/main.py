"""ShopAI FastAPI Application.

Provides REST API endpoints for product image analysis, attribute extraction,
and serves the vanilla HTML/CSS/JS frontend.
"""

import asyncio
from contextlib import asynccontextmanager
import logging
import os
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.ai_service import ai_service
from backend.schemas import ErrorResponse, HealthResponse, ProductDescriptionResponse

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("shopai.api")

ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
}
MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifecycle management.
    Triggers model download and loading in a background thread so the server
    can immediately boot and report health status accurately.
    """
    logger.info("Initializing ShopAI backend...")
    # Launch model load in background thread to avoid blocking server readiness
    asyncio.create_task(asyncio.to_thread(ai_service.load_model))
    yield
    logger.info("Shutting down ShopAI backend.")


app = FastAPI(
    title="ShopAI API",
    description="AI-powered product description and attribute generator for Shopify shopkeepers",
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for local development flexibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get(
    "/api/health",
    response_model=HealthResponse,
    summary="Check server and model readiness",
    tags=["System"],
)
async def health_check() -> HealthResponse:
    """
    Returns server operational status and whether the BLIP model weights
    have completed loading into memory.
    """
    return HealthResponse(
        status="ok",
        model_loaded=ai_service.is_loaded,
        device=ai_service.device,
        model_name=ai_service.MODEL_ID,
        version="1.0.0",
    )


@app.post(
    "/api/generate-description",
    response_model=ProductDescriptionResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid image or input"},
        413: {"model": ErrorResponse, "description": "Image exceeds size limit"},
        503: {"model": ErrorResponse, "description": "Model not loaded / unavailable"},
        504: {"model": ErrorResponse, "description": "Inference timed out"},
    },
    summary="Analyze product image and generate editable product content",
    tags=["Product Generation"],
)
async def generate_description(
    image: UploadFile = File(..., description="Product image (JPG, PNG, WEBP, max 10MB)"),
    title: Optional[str] = Form(None, description="Optional merchant title"),
    brand: Optional[str] = Form(None, description="Optional merchant brand name"),
    category: Optional[str] = Form(None, description="Optional category hint"),
) -> ProductDescriptionResponse:
    """
    Accepts an uploaded image with optional merchant hints, validates the payload,
    executes Salesforce BLIP captioning, extracts deterministic visual attributes,
    and returns a structured four-section product proposal.
    """
    # 1. Check content-type header & extension
    content_type = (image.content_type or "").lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        ext = os.path.splitext(image.filename or "")[1].lower()
        if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported image format: {content_type or ext}. Please upload a JPG, JPEG, PNG, or WEBP image.",
            )

    # 2. Read image bytes with size guard
    try:
        image_bytes = await image.read()
    except Exception as exc:
        logger.error(f"Error reading uploaded file: {exc}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to read uploaded image data.",
        )

    if len(image_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    if len(image_bytes) > MAX_IMAGE_SIZE_BYTES:
        raise HTTPException(
            status_code=getattr(status, "HTTP_413_CONTENT_TOO_LARGE", 413),
            detail=f"Image size ({len(image_bytes) / (1024 * 1024):.1f} MB) exceeds maximum allowed limit of 10 MB.",
        )

    # 3. Validate image decodability before model dispatch
    try:
        rgb_image = ai_service.validate_and_open_image(image_bytes)
    except ValueError as val_err:
        logger.warning(f"Image validation rejected upload: {val_err}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err),
        )

    # 4. Check model availability
    if not ai_service.is_loaded:
        if ai_service.load_error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Model failed to initialize: {ai_service.load_error}. Check server logs.",
            )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The AI model is currently loading weights into memory. Please wait a moment and try again.",
        )

    # 5. Run inference asynchronously with protective timeout
    try:
        # 60s timeout for CPU inference safety
        caption = await asyncio.wait_for(
            asyncio.to_thread(ai_service.generate_caption, rgb_image),
            timeout=60.0,
        )
        logger.info(f"Generated caption: '{caption}'")
        from backend.attribute_extractor import build_product_analysis
        response = build_product_analysis(
            image=rgb_image,
            caption=caption,
            user_title=title,
            user_brand=brand,
            user_category=category,
        )
        return response
    except asyncio.TimeoutError:
        logger.error("Inference timed out after 60 seconds.")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Image analysis timed out. Please try with a smaller image or retry.",
        )
    except ValueError as val_err:
        logger.warning(f"Image validation rejected upload: {val_err}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err),
        )
    except Exception as exc:
        logger.error(f"Unexpected inference error: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while analyzing the product image. Please retry.",
        )


# Mount static frontend files if frontend directory exists
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
