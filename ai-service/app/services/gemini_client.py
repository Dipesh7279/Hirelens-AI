"""
Shared Gemini client. Every module that needs an LLM call (resume parsing,
scoring explanations, interview questions, feedback) goes through here so
retry/logging/config lives in one place.

Uses the `google-genai` SDK (`from google import genai`) — the older
`google-generativeai` package is deprecated by Google and should not be
used for new work.
"""
import json
import logging
import random
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from importlib.metadata import PackageNotFoundError, version
from typing import Any
import httpx
from google import genai
from google.genai import errors, types
try:
    from google.genai._gaos.lib import compat_errors
    GENAI_API_ERRORS = (errors.APIError, compat_errors.APIError)
    GENAI_TIMEOUT_ERRORS = (httpx.TimeoutException, TimeoutError, compat_errors.APITimeoutError)
except ImportError:
    GENAI_API_ERRORS = (errors.APIError,)
    GENAI_TIMEOUT_ERRORS = (httpx.TimeoutException, TimeoutError)
from app.core.config import DEFAULT_GEMINI_MODEL, get_settings

settings = get_settings()
_client = None
logger = logging.getLogger(__name__)
RETRYABLE_STATUS_CODES = {408, 500, 502, 503, 504}
# Keep provider attempts comfortably below the Node API's 30-second resume-parse deadline.
GEMINI_REQUEST_TIMEOUT_MS = 16_000
MAX_RETRY_DELAY_SECONDS = 2
FALLBACK_GEMINI_MODEL = "gemini-3-flash-preview"
SECONDARY_GEMINI_MODELS = ("gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite")


def get_client() -> genai.Client:
    global _client
    current_settings = get_settings()
    key = current_settings.GEMINI_API_KEY
    if not key or key.startswith("replace_with"):
        raise GeminiAPIError("GEMINI_API_KEY is missing or unconfigured. Please configure a valid key in ai-service/.env", status_code=401)
    if _client is None:
        _client = genai.Client(
            api_key=key,
            http_options=types.HttpOptions(
                timeout=GEMINI_REQUEST_TIMEOUT_MS,
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        )
        try:
            from google.genai._gaos.utils import retries as gaos_retries
            if hasattr(_client, "interactions") and hasattr(_client.interactions, "sdk_configuration"):
                _client.interactions.sdk_configuration.retry_config = gaos_retries.RetryConfig(
                    strategy="none",
                    backoff=None,
                    retry_connection_errors=False,
                )
        except Exception as e:
            logger.warning("Could not disable _gaos internal retry_config: %s", e)
    return _client


class GeminiJSONError(Exception):
    pass


class GeminiAPIError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _retry_delay_seconds(error: Exception, attempt: int) -> float:
    """Honor short Retry-After hints, otherwise use capped exponential backoff + jitter."""
    response = getattr(error, "response", None)
    headers = getattr(response, "headers", {}) or {}
    delay = None
    try:
        retry_after_ms = headers.get("retry-after-ms") or headers.get("Retry-After-Ms")
        retry_after = headers.get("retry-after") or headers.get("Retry-After")
        if retry_after_ms is not None:
            delay = float(retry_after_ms) / 1000
        elif retry_after is not None:
            try:
                delay = float(retry_after)
            except (TypeError, ValueError):
                retry_at = parsedate_to_datetime(retry_after)
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=timezone.utc)
                delay = (retry_at - datetime.now(timezone.utc)).total_seconds()
    except (TypeError, ValueError):
        delay = None
    if delay is None:
        delay = min(0.5 * (2 ** attempt), MAX_RETRY_DELAY_SECONDS)
        delay += random.uniform(0, 0.25)
    return max(0, min(delay, MAX_RETRY_DELAY_SECONDS))


def _safe_provider_status(error: Exception) -> str:
    """Return only the provider's enum-like status, never its raw error body."""
    status = getattr(error, "status", None)
    if isinstance(status, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", status):
        return status
    return "UNKNOWN"


def _safe_invalid_fields(error: Exception) -> str:
    """Extract field paths only; provider descriptions can contain sensitive data."""
    body = getattr(error, "details", None) or getattr(error, "body", None)
    if not isinstance(body, dict):
        return "unknown"
    error_body = body.get("error") if isinstance(body.get("error"), dict) else body
    if not isinstance(error_body, dict):
        return "unknown"
    groups = error_body.get("details")
    if not isinstance(groups, list):
        return "unknown"

    fields = []
    for group in groups:
        if not isinstance(group, dict):
            continue
        violations = group.get("fieldViolations")
        if not isinstance(violations, list):
            continue
        for violation in violations:
            if not isinstance(violation, dict):
                continue
            field = violation.get("field")
            if (
                isinstance(field, str)
                and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.\[\]-]{0,119}", field)
                and field not in fields
            ):
                fields.append(field)
            if len(fields) == 4:
                break
        if len(fields) == 4:
            break
    return ",".join(fields) if fields else "unknown"


def call_gemini_json(
    system_prompt: str, user_prompt: str, max_retries: int = 2
) -> Any:
    """
    Calls Gemini with a system+user prompt and expects a JSON-only response.
    Strips markdown code fences defensively (models sometimes add them
    despite instructions) and retries parse failures up to max_retries times.
    """
    client = get_client()
    if hasattr(client, "interactions") and hasattr(client.interactions, "sdk_configuration"):
        try:
            from google.genai._gaos.utils import retries as gaos_retries
            cfg = getattr(client.interactions.sdk_configuration, "retry_config", None)
            if cfg is not None and getattr(cfg, "strategy", None) != "none":
                client.interactions.sdk_configuration.retry_config = gaos_retries.RetryConfig(
                    strategy="none",
                    backoff=None,
                    retry_connection_errors=False,
                )
        except Exception:
            pass
    last_error = None
    model = settings.GEMINI_MODEL
    try:
        sdk_version = version("google-genai")
    except PackageNotFoundError:
        sdk_version = "unknown"
    logger.info("Gemini request configuration: model=%s google-genai=%s", model, sdk_version)
    attempt = 0
    fallback_attempted = False
    while attempt <= max_retries:
        request_timeout = (GEMINI_REQUEST_TIMEOUT_MS / 1000) if (attempt == 0 or fallback_attempted) else 8.0
        try:
            response = client.interactions.create(
                model=model,
                input=user_prompt,
                system_instruction=system_prompt,
                response_format={
                    "type": "text",
                    "mime_type": "application/json",
                },
                store=False,
                timeout=request_timeout,
            )
        except GENAI_TIMEOUT_ERRORS as e:
            if (
                model in {"gemini-3.8-flash", "gemini-2.5-flash"}
                and not fallback_attempted
            ):
                logger.warning(
                    "Model %s timed out; falling back to %s",
                    model,
                    FALLBACK_GEMINI_MODEL,
                )
                model = FALLBACK_GEMINI_MODEL
                fallback_attempted = True
                attempt += 1
                continue
            if attempt < max_retries:
                delay = _retry_delay_seconds(e, attempt)
                logger.warning(
                    "Gemini request timed out; retry %s/%s in %.2fs",
                    attempt + 1,
                    max_retries,
                    delay,
                )
                time.sleep(delay)
                attempt += 1
                continue
            raise GeminiAPIError(
                f"Gemini is temporarily unavailable after {attempt} retries. Please try again shortly.",
                status_code=503,
            ) from e
        except GENAI_API_ERRORS as e:
            code = (
                getattr(e, "status_code", None)
                or getattr(e, "code", None)
                or getattr(getattr(e, "response", None), "status_code", None)
            )
            if code == 429:
                logger.warning(
                    "Gemini rate limit reached (HTTP 429) for model %s; not retrying to avoid request timeout",
                    model,
                )
                raise GeminiAPIError(
                    "Gemini rate limit reached (HTTP 429). Please try again shortly.",
                    status_code=429,
                ) from e
            if (
                code == 404
                and model == "gemini-2.5-flash"
                and DEFAULT_GEMINI_MODEL != model
                and not fallback_attempted
            ):
                logger.warning(
                    "Configured legacy Gemini model was not found (HTTP 404); retrying with the current default model"
                )
                model = DEFAULT_GEMINI_MODEL
                fallback_attempted = True
                continue
            if (
                code in {404, 503}
                and model in {"gemini-3.8-flash", "gemini-2.5-flash"}
                and not fallback_attempted
            ):
                logger.warning(
                    "Model %s unavailable (HTTP %s); falling back to %s",
                    model,
                    code,
                    FALLBACK_GEMINI_MODEL,
                )
                model = FALLBACK_GEMINI_MODEL
                fallback_attempted = True
                continue
            if code in RETRYABLE_STATUS_CODES and attempt < max_retries:
                delay = _retry_delay_seconds(e, attempt)
                if model in {FALLBACK_GEMINI_MODEL, *SECONDARY_GEMINI_MODELS}:
                    next_idx = min(attempt, len(SECONDARY_GEMINI_MODELS) - 1)
                    model = SECONDARY_GEMINI_MODELS[next_idx]
                logger.warning(
                    "Gemini returned transient HTTP %s; retry %s/%s in %.2fs (model=%s)",
                    code,
                    attempt + 1,
                    max_retries,
                    delay,
                    model,
                )
                time.sleep(delay)
                attempt += 1
                continue
            if code in RETRYABLE_STATUS_CODES:
                raise GeminiAPIError(
                    f"Gemini is temporarily unavailable (HTTP {code}) after {attempt} retries. Please try again shortly.",
                    status_code=code,
                ) from e
            # Provider messages may contain request/response details. Keep only
            # the status for safe client-facing diagnostics.
            logger.warning(
                "Gemini rejected model %s with HTTP %s (provider_status=%s invalid_fields=%s)",
                model,
                code,
                _safe_provider_status(e),
                _safe_invalid_fields(e),
            )
            raise GeminiAPIError(
                f"Gemini rejected the request (HTTP {code}). Check model and API configuration.",
                status_code=code,
            ) from e

        raw = (response.output_text or "").strip()
        raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()

        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            last_error = e
            attempt += 1

    raise GeminiJSONError(f"Gemini did not return valid JSON after {max_retries + 1} attempts: {last_error}")
