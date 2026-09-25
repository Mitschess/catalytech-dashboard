"""Start the Catalytech SIGAP server: python run.py  (then open http://localhost:8000)."""
import os

import uvicorn

from app import config  # noqa: F401  loads backend/.env first, so HOST/PORT set there take effect

if __name__ == "__main__":
    uvicorn.run("app.main:app", host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")), reload=False)
