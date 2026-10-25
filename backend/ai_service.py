"""AI Service for ShopAI.

Loads Salesforce/blip-image-captioning-base once and provides thread-safe
inference methods for caption generation and product attribute extraction.
"""

import io
import logging
from typing import Optional, Tuple
import torch
from PIL import Image
from transformers import BlipProcessor, BlipForConditionalGeneration

from backend.attribute_extractor import build_product_analysis
from backend.schemas import ProductDescriptionResponse

logger = logging.getLogger("shopai.ai_service")

# Pillow safety limits to protect against decompression bombs
Image.MAX_IMAGE_PIXELS = 25_000_000


class AIService:
    """Manages the Salesforce BLIP model lifecycle and image inference."""

    MODEL_ID = "Salesforce/blip-image-captioning-base"

    def __init__(self) -> None:
        self.processor: Optional[BlipProcessor] = None
        self.model: Optional[BlipForConditionalGeneration] = None
        self.device: str = "cuda" if torch.cuda.is_available() else "cpu"
        self.is_loaded: bool = False
        self.load_error: Optional[str] = None

    def load_model(self) -> bool:
        """
        Loads processor and model weights onto the appropriate device.
        Cached in Hugging Face standard hub directory.
        """
        if self.is_loaded and self.model is not None and self.processor is not None:
            return True

        logger.info(f"Loading {self.MODEL_ID} on device '{self.device}'...")
        try:
            self.processor = BlipProcessor.from_pretrained(self.MODEL_ID)
            self.model = BlipForConditionalGeneration.from_pretrained(self.MODEL_ID)
            self.model.to(self.device)
            self.model.eval()
            self.is_loaded = True
            self.load_error = None
            logger.info("BLIP model loaded successfully and ready for inference.")
            return True
        except Exception as exc:
            self.is_loaded = False
            self.load_error = str(exc)
            logger.error(f"Failed to load BLIP model: {exc}", exc_info=True)
            return False

    def validate_and_open_image(self, image_bytes: bytes) -> Image.Image:
        """
        Safely validates image bytes, guards against corrupt data and decompression bombs,
        and converts to RGB.
        """
        if not image_bytes or len(image_bytes) == 0:
            raise ValueError("Uploaded image file is empty.")

        if len(image_bytes) > 10 * 1024 * 1024:
            raise ValueError("Image file exceeds maximum allowed size (10 MB).")

        try:
            # First pass: verify integrity
            test_stream = io.BytesIO(image_bytes)
            with Image.open(test_stream) as img_verify:
                img_verify.verify()
        except Exception as exc:
            raise ValueError(f"Invalid or corrupted image format: {exc}")

        # Second pass: reopen for actual processing (verify closes stream in Pillow)
        try:
            img = Image.open(io.BytesIO(image_bytes))
            # Convert to RGB to normalize grayscale/RGBA
            rgb_img = img.convert("RGB")
            return rgb_img
        except Exception as exc:
            raise ValueError(f"Unable to decode image pixels: {exc}")

    def generate_caption(self, image: Image.Image) -> str:
        """
        Runs BLIP captioning inference on an RGB PIL Image under torch.inference_mode().
        """
        if not self.is_loaded or self.model is None or self.processor is None:
            raise RuntimeError(
                f"BLIP model is not loaded. Current error: {self.load_error or 'Model not initialized'}"
            )

        with torch.inference_mode():
            inputs = self.processor(images=image, return_tensors="pt").to(self.device)
            out = self.model.generate(
                **inputs,
                max_length=60,
                min_length=8,
                num_beams=3,
                repetition_penalty=1.2,
            )
            caption = self.processor.decode(out[0], skip_special_tokens=True).strip()

        return caption

    def analyze_product_image(
        self,
        image_bytes: bytes,
        user_title: Optional[str] = None,
        user_brand: Optional[str] = None,
        user_category: Optional[str] = None,
    ) -> ProductDescriptionResponse:
        """
        Validates the image, runs BLIP captioning, and extracts structured
        attributes, title, description, and key features.
        """
        # Validate and prepare image
        rgb_image = self.validate_and_open_image(image_bytes)

        # Generate actual BLIP caption
        caption = self.generate_caption(rgb_image)
        logger.info(f"Generated caption: '{caption}'")

        # Extract attributes and build full response
        response = build_product_analysis(
            image=rgb_image,
            caption=caption,
            user_title=user_title,
            user_brand=user_brand,
            user_category=user_category,
        )

        return response


# Global singleton instance
ai_service = AIService()
