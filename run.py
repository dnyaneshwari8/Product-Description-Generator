"""ShopAI Runner script.

Starts the FastAPI server hosting both the REST API and the static frontend.
"""

import sys
import uvicorn

if __name__ == "__main__":
    print("=" * 60)
    print("  ShopAI: AI Product Description Generator for Shopify")
    print("  Backend API:  http://127.0.0.1:8000/api/health")
    print("  Application:  http://127.0.0.1:8000/")
    print("  Demo Login:   admin / admin@124")
    print("=" * 60)
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=False)
