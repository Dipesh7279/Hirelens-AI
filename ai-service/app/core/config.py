import os
from pathlib import Path
from functools import lru_cache
from dotenv import load_dotenv

# Load ai-service/.env no matter where uvicorn is started from
load_dotenv(Path(__file__).resolve().parents[2] / ".env",override=True)

DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"


class Settings:
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "").strip().strip('"').strip("'")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    MAX_UPLOAD_MB: int = int(os.getenv("MAX_UPLOAD_MB", "5"))
    ALLOWED_EXTENSIONS: set = {".pdf", ".docx"}
    INTERNAL_SERVICE_KEY: str = os.getenv("INTERNAL_SERVICE_KEY", "hirelens-internal-shared-secret-dev").strip().strip('"').strip("'")


@lru_cache
def get_settings() -> Settings:
    return Settings()
