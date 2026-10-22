from fastapi import APIRouter, HTTPException

from app.models.interview_schema import QuestionRequest, QuestionResponse
from app.services.gemini_client import GeminiAPIError, GeminiJSONError
from app.services.interview_generator import generate_questions

router = APIRouter(prefix="/interview", tags=["Interview"])


@router.post("/generate-questions", response_model=QuestionResponse)
async def generate(request: QuestionRequest):
    try:
        return await generate_questions(request)
    except GeminiAPIError as error:
        if error.status_code == 429:
            raise HTTPException(status_code=429, detail="AI provider rate limit exceeded. Please retry shortly.") from error
        if error.status_code == 408:
            raise HTTPException(status_code=408, detail="AI provider request timed out. Please retry.") from error
        if error.status_code in {500, 502, 503, 504}:
            raise HTTPException(status_code=503, detail="AI provider is temporarily unavailable. Please retry.") from error
        raise HTTPException(status_code=502, detail="Interview questions could not be generated. Please retry.") from error
    except (GeminiJSONError, ValueError) as error:
        raise HTTPException(status_code=502, detail="Interview questions could not be generated. Please retry.") from error
