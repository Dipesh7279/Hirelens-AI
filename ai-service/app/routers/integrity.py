import io

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from PIL import Image, UnidentifiedImageError

from app.models.interview_schema import FrameAnalysis
from app.services.cv_pipeline import CVUnavailable, analyze_frame

router = APIRouter(prefix="/integrity", tags=["Integrity"])
MAX_FRAME_BYTES = 1_000_000  # frames are downscaled JPEGs, ~50-150KB
MAX_FRAME_PIXELS = 2_000_000


@router.post("/analyze-frame", response_model=FrameAnalysis)
async def analyze(file: UploadFile = File(...)):
    if file.content_type not in ("image/jpeg", "image/png"):
        raise HTTPException(status_code=400, detail="Frame must be JPEG or PNG")
    data = await file.read(MAX_FRAME_BYTES + 1)
    if len(data) > MAX_FRAME_BYTES:
        raise HTTPException(status_code=413, detail="Frame too large")
    try:
        with Image.open(io.BytesIO(data)) as image:
            expected_format = "JPEG" if file.content_type == "image/jpeg" else "PNG"
            if image.format != expected_format:
                raise HTTPException(status_code=400, detail="Frame content must be JPEG or PNG")
            if image.width * image.height > MAX_FRAME_PIXELS:
                raise HTTPException(status_code=413, detail="Frame dimensions are too large")
            image.verify()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise HTTPException(status_code=422, detail="Frame content is invalid or corrupt") from error
    try:
        # Frame is processed in memory and discarded - never written to disk.
        return await run_in_threadpool(analyze_frame, data)
    except CVUnavailable as e:
        raise HTTPException(status_code=503, detail="Automated frame analysis is unavailable") from e
    except Exception:
        raise HTTPException(status_code=422, detail="Could not analyze frame")
