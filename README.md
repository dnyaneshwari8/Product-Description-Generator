# ShopAI: AI Product Description Generator for Shopify

**ShopAI** is a local web application designed for Shopify shopkeepers and merchants. It analyzes uploaded product images using the pretrained **Salesforce/blip-image-captioning-base** vision-language model and deterministic computer vision algorithms to generate four editable product content sections:
1. **Product Title**
2. **Visual Attributes** (Category, Main Color, Shape / Style, Pattern, Visible Texture)
3. **Full Product Description** (Grounded, Shopify-ready marketing copy)
4. **Key Features** (Editable structured bullet points)

---

## Architecture & Honesty Statement

- **AI Model**: [Salesforce/blip-image-captioning-base](https://huggingface.co/Salesforce/blip-image-captioning-base) loaded locally via Hugging Face `transformers` and PyTorch.
- **Model Limitation**: BLIP is a pretrained image captioning model, **not** a custom-trained classifier or specialized e-commerce attribute detector.
- **Deterministic Attribute Extraction**:
  - **Dominant Color**: Extracted using deterministic computer-vision pixel analysis (Pillow). Background border pixels are sampled and filtered out to estimate foreground color clusters and map them to human-readable names.
  - **Category**: Derived from optional merchant hints or conservative caption keyword heuristics.
  - **Shape / Silhouette & Pattern**: Extracted from caption heuristics only when reasonable visual cues exist.
  - **Texture & Materials**: **Never infers unobservable properties.** The application strictly avoids fabricating material composition (e.g., "100% Egyptian cotton" or "genuine leather"), dimensions, waterproof ratings, or performance claims. Uncertain attributes are honestly flagged as `Not confidently detected` or `Uncertain` for merchant verification.
- **Frontend**: Plain HTML5, CSS3, and vanilla JavaScript (ES6+). Zero React, Vue, build tools, or frontend dependencies.
- **Storage**: Client-side **IndexedDB** (`ShopAIDatabase`) for product records and image blobs. No large base64 strings in `localStorage`.

---

## The Three Application Views

1. **Sign-in View (`#view-signin`)**
   - Clean Shopify-inspired login screen.
   - Demo credentials: **Username:** `admin` | **Password:** `admin@124`.
   - Client session stored in `sessionStorage`.
   - *Security Note*: This is a local-demo authentication mechanism designed for evaluation, not a production-grade identity provider.
2. **Product Catalogue View (`#view-catalogue`)**
   - Displays heading **"My Products"** and a top-right **"+ Add Product"** button.
   - Automatically seeded **only once** on first launch with **10 realistic sample products** (Classic Blue Shirt, Floral Summer Dress, Everyday Sneakers, Structured Handbag, Minimal Wristwatch, Cotton T-Shirt, Running Shoes, Printed Scarf, Denim Jacket, Everyday Backpack).
   - Prices formatted in Indian Rupee (₹ INR) for Indian merchants.
   - Real-time search filter (title, SKU, category) and category dropdown filter.
   - Card click navigates to the Add/Edit Product view with all fields populated.
   - Includes empty-state handling with a button to restore initial samples.
3. **Add / Edit Product View (`#view-editor`)**
   - **Responsive two-column layout** (left: inputs & controls; right: generated outputs).
   - **Left Column**:
     - Drag-and-drop & file picker image uploader (JPG, JPEG, PNG, WEBP up to 10MB).
     - Live image preview, replace, and clear controls.
     - Optional merchant hints (Title, Brand name, Category hint, Custom category).
     - **"⚡ Generate Description & Attributes"** button with live spinner and backend error banners.
     - Inventory fields: Price (₹), Quantity in stock, SKU.
     - Action buttons: **"Save Product"** (primary), **"Save Draft"** (secondary), **"← Back to Products"**.
     - Confirmation guards against losing unsaved changes.
   - **Right Column (Exactly 4 Editable Sections)**:
     1. **Product Title**: Single-line editable input.
     2. **Visual Attributes**: Five editable fields with confidence badges (`Category`, `Main Color`, `Shape / Style`, `Pattern`, `Visible Texture`).
     3. **Full Product Description**: Multi-line textarea prefilled with natural, grounded marketing copy.
     4. **Key Features**: Dynamic bullet points list allowing merchants to add (`+ Add Feature`), edit, or remove lines.
     5. Notice banner: `⚠️ AI-generated details may be inaccurate. Please verify all attributes before publishing.`

---

## Directory Structure

```text
shopai-product-generator/
│
├── backend/
│   ├── __init__.py               # Backend package marker
│   ├── main.py                   # FastAPI app, CORS, routes & static file mount
│   ├── ai_service.py             # Salesforce BLIP model loader & inference manager
│   ├── attribute_extractor.py    # CV color extraction & caption attribute heuristics
│   ├── schemas.py                # Pydantic schemas and API contracts
│   └── requirements.txt          # Python dependency specifications
│
├── frontend/
│   ├── index.html                # Semantic HTML5 single-page application (3 views)
│   ├── styles.css                # Responsive Shopify-inspired design system
│   └── app.js                    # Vanilla JS data layer, IndexedDB & UI state
│
├── tests/
│   ├── __init__.py               # Test package marker
│   ├── test_api.py               # API integration tests (health, 400, 413, 422, mock flow)
│   ├── test_attribute_extractor.py # Unit tests for CV color, category, texture & title logic
│   └── test_real_inference.py    # End-to-end inference verification with downloaded BLIP model
│
├── run.py                        # Single-command runner for FastAPI server & frontend
├── .gitignore                    # Git ignore file for Python, HF cache, and OS artifacts
└── README.md                     # Comprehensive project documentation
```

---

## Prerequisites & Supported Environments

- **Python**: Version 3.10+ (tested and verified on Python 3.10.2 on Windows 10/11).
- **RAM**: Minimum 4 GB free RAM (8 GB+ recommended for CPU model inference).
- **Disk Space**: ~1.5 GB free disk space for PyTorch and cached Hugging Face model weights (`~990 MB`).
- **Network**: Internet access is required during the initial run to download the pretrained model weights from Hugging Face Hub. Once downloaded, weights are cached locally in `~/.cache/huggingface/hub` and subsequent runs can work offline.
- **GPU (Optional)**: Automatically uses NVIDIA CUDA if `torch.cuda.is_available()` is True; otherwise defaults to CPU inference.

---

## Windows PowerShell Setup & Run Instructions

### 1. Open PowerShell and Navigate to the Project Folder
```powershell
cd c:\Users\Dnt\Documents\shopai-product-generator
```

### 2. (Optional) Create and Activate a Virtual Environment
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```
*(If PowerShell restricts script execution, run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process` first).*

### 3. Install Dependencies
```powershell
pip install -r backend/requirements.txt
```

### 4. Run the Test Suite
Verify that all unit, API, and live inference tests pass:
```powershell
python -m pytest tests/ -v
```

### 5. Launch the Application
Start the unified application (FastAPI backend + static frontend):
```powershell
python run.py
```
*Alternatively, start with uvicorn directly:*
```powershell
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

### 6. Access in Your Browser
Open your browser and navigate to:
```text
http://127.0.0.1:8000/
```
Sign in with the demo credentials:
- **Username:** `admin`
- **Password:** `admin@124`

---

## First Run & Inference Expectations

1. **Model Download**: On the very first run, the Hugging Face `transformers` library will download the `Salesforce/blip-image-captioning-base` checkpoint (`~990 MB`). This download happens in the background at server startup or during the first request.
2. **CPU Inference Speed**: On a standard modern CPU, image analysis takes **4 to 10 seconds** per image.
3. **CUDA GPU Speed**: On an NVIDIA GPU with CUDA, inference typically takes **0.5 to 1.5 seconds**.
4. **Memory Footprint**: The model requires approximately 1.2 GB of system RAM in CPU mode.

---

## Browser Storage & Resetting Data

- Product items, sample thumbnails, and user-uploaded image blobs are saved in the browser's local **IndexedDB** database named `ShopAIDatabase` under the object store `products`.
- Records persist across page reloads and browser restarts without requiring an external database server.
- **To Reset the Catalogue**: Click the **"Reset Samples"** button on the catalogue toolbar to restore the original 10 sample products at any time.

---

## Troubleshooting Guide

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| **Backend Offline banner in UI** | FastAPI server is not running on port 8000. | Run `python run.py` in PowerShell and check that the server is listening on `127.0.0.1:8000`. |
| **HTTP 503 "Model is loading weights"** | First inference request made while weights are downloading or initializing. | Wait a few seconds for the status pill in the top header to turn green (`AI Ready (CPU)`), then click Generate again. |
| **Port 8000 already in use** | Another process is occupying port 8000. | Stop the conflicting process or change port in `run.py` to `8080` (e.g. `uvicorn.run("backend.main:app", host="127.0.0.1", port=8080)`). |
| **Symlink warning on Windows** | Hugging Face Hub uses hardlinks when Developer Mode is disabled. | This is completely benign and does not affect operation. Caching still works as expected. |
| **Image rejected: "Image exceeds 10MB"** | Uploaded image is larger than 10 MB. | Compress or resize the image before uploading. |
| **Image rejected: "Invalid or corrupted format"** | Uploaded file failed Pillow decode verification. | Ensure the file is an uncorrupted JPG, JPEG, PNG, or WEBP image. |
| **Storage full or quota exceeded** | Browser IndexedDB quota reached. | Clear old draft products using browser developer tools or reset samples. |

---

## Security Disclaimer

The authentication implemented in this local demo application (`admin` / `admin@124`) is intended solely for local developer demonstration and evaluation purposes. In a production Shopify integration, authentication must be implemented via **Shopify OAuth 2.0**, secure HTTPS-only session cookies, and appropriate access tokens.
