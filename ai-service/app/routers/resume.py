from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.concurrency import run_in_threadpool
from app.core.config import get_settings
from app.services.resume_extractor import (
    extract_raw_text,
    UnsupportedFileTypeError,
    EmptyResumeError,
    InvalidResumeFileError,
)
from app.services.resume_structurer import structure_resume_with_mode, ResumeStructuringError
from app.services.gemini_client import GeminiAPIError
from app.services.authenticity_checker import check_authenticity
from app.models.resume_schema import ResumeParseResponse

router = APIRouter(prefix="/resume", tags=["resume"])
settings = get_settings()


@router.post("/parse", response_model=ResumeParseResponse)
async def parse_resume(file: UploadFile = File(...)):
    """
    Full Module 2 pipeline in one call:
      1. Extract raw text from the uploaded PDF/DOCX.
      2. Structure it with Gemini, or conservatively extract known skills if Gemini is unavailable.
      3. Run the authenticity heuristic.

    The authenticated Node backend sends the file bytes for parsing and
    persists the original in its configured private object storage only
    after successful parsing. This service never stores uploaded files.
    """
    ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "" # type: ignore
    if ext not in settings.ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    chunks = []
    total_bytes = 0
    while True:
        chunk = await file.read(min(64 * 1024, max_bytes + 1 - total_bytes))
        if not chunk:
            break
        chunks.append(chunk)
        total_bytes += len(chunk)
        if total_bytes > max_bytes:
            break
    if total_bytes > max_bytes:
        size_mb = total_bytes / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({size_mb:.1f}MB). Max is {settings.MAX_UPLOAD_MB}MB.",
        )
    file_bytes = b"".join(chunks)

    try:
        raw_text = extract_raw_text(file_bytes, file.filename) # type: ignore
    except UnsupportedFileTypeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except InvalidResumeFileError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except EmptyResumeError as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        parsed, parsing_mode = await run_in_threadpool(structure_resume_with_mode, raw_text)
    except ResumeStructuringError as e:
        raise HTTPException(
            status_code=502,
            detail="Resume text could not be structured. Please check the document and try again.",
        ) from e
    except GeminiAPIError as e:
        if e.status_code in {400, 401, 403, 404}:
            error_codes = {
                400: "GEMINI_REQUEST_REJECTED",
                401: "GEMINI_API_KEY_INVALID",
                403: "GEMINI_ACCESS_DENIED",
                404: "GEMINI_MODEL_NOT_FOUND",
            }
            raise HTTPException(
                status_code=503,
                detail="Gemini configuration or access was rejected.",
                headers={"X-Error-Code": error_codes[e.status_code]},
            ) from e
        raise HTTPException(status_code=e.status_code or 503, detail=str(e))

    authenticity = check_authenticity(raw_text)

    return ResumeParseResponse(
        rawText=raw_text,
        parsed=parsed,
        authenticity=authenticity,
        parsingMode=parsing_mode,
    )
