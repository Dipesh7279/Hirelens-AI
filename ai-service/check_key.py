from app.core.config import get_settings
from app.services.gemini_client import GeminiAPIError, call_gemini_json


settings = get_settings()
try:
    call_gemini_json("Return a JSON object with an ok field.", "Return {\"ok\": true}.", max_retries=0)
except GeminiAPIError as error:
    status = f" (HTTP {error.status_code})" if error.status_code is not None else ""
    print(f"Gemini configuration check failed{status}: {error}")
    raise SystemExit(1) from error

print(f"Gemini configuration check succeeded using {settings.GEMINI_MODEL}.")
