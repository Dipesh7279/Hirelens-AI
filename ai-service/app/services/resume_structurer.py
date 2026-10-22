"""
Step 2 of the resume pipeline: raw text -> structured fields via Gemini,
validated against ResumeParsed. This is the JSON-forcing prompt from the
blueprint (Section 3), kept in one place so it's easy to tune.
"""
import logging
from pydantic import ValidationError
from app.services.gemini_client import call_gemini_json, GeminiJSONError, GeminiAPIError
from app.models.resume_schema import ResumeParsed
from app.services.resume_fallback import parse_resume_fallback
from app.services.resume_extractor import extract_github_username
from app.services.pii_anonymizer import anonymize_text

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a resume-parsing engine. Return ONLY valid JSON, no markdown,
no commentary, matching exactly this schema: {skills:[string],
education:[{degree,institute,year}], experience:[{role,company,duration}],
projects:[{title,description,techStack:[string]}], githubUsername: string or null}. If a field is not found,
use an empty array (or null for githubUsername)."""


class ResumeStructuringError(Exception):
    pass


def structure_resume(raw_text: str) -> ResumeParsed:
    """
    Calls Gemini to convert raw resume text into the fixed schema, then
    validates the output with pydantic. Retries once on schema mismatch
    (as distinct from the JSON-parse retry already inside gemini_client).
    """
    if not isinstance(raw_text, str):
        raise ResumeStructuringError(f"raw_text must be a string, got {type(raw_text).__name__}")

    return structure_resume_with_mode(raw_text)[0]


def structure_resume_with_mode(raw_text: str) -> tuple[ResumeParsed, str]:
    """Return structured content and disclose whether the heuristic fallback was used."""
    if not isinstance(raw_text, str):
        raise ResumeStructuringError(f"raw_text must be a string, got {type(raw_text).__name__}")

    extracted_github = extract_github_username(raw_text)
    sanitized_text = anonymize_text(raw_text)

    for attempt in range(2):
        try:
            data = call_gemini_json(SYSTEM_PROMPT, sanitized_text, max_retries=1)
            if not isinstance(data, dict):
                raise TypeError(
                    f"Gemini returned a non-object payload: {type(data).__name__}"
                )
            parsed = ResumeParsed(**data)
            if not parsed.githubUsername:
                parsed.githubUsername = extracted_github
            return parsed, "gemini"
        except GeminiAPIError as error:
            # A rejected generation request is not a reason to reject an
            # otherwise valid resume. Return the conservative, disclosed local
            # parser result instead. Authentication and access errors remain
            # actionable configuration failures rather than being hidden.
            if error.status_code is None or error.status_code in {400, 408, 429, 500, 502, 503, 504}:
                reason = str(error.status_code) if error.status_code is not None else "configuration-or-transport"
                logger.warning(
                    "Gemini resume structuring unavailable (status=%s); using heuristic fallback",
                    reason,
                )
                return parse_resume_fallback(raw_text), "heuristic_fallback"
            raise
        except (GeminiJSONError, ValidationError, TypeError, ValueError, Exception) as e:
            if attempt == 1:
                logger.warning(
                    "Gemini returned unusable structured resume output after retry; using heuristic fallback"
                )
                return parse_resume_fallback(raw_text), "heuristic_fallback"
            continue

    raise ResumeStructuringError("Failed to structure resume after retry.")
