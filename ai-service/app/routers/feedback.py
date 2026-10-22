from fastapi import APIRouter, HTTPException
from app.models.feedback_schema import FeedbackRequest, FeedbackResponse
from app.services.feedback_gen import generate_feedback
from app.services.gemini_client import GeminiAPIError, GeminiJSONError

router = APIRouter(prefix="/feedback", tags=["Feedback"])


@router.post("/generate", response_model=FeedbackResponse)
async def generate(request: FeedbackRequest):
    try:
        return FeedbackResponse(feedback=await generate_feedback(request))
    except GeminiAPIError as error:
        if error.status_code in {408, 429}:
            status_code = error.status_code
        elif error.status_code in {500, 502, 503, 504}:
            status_code = 503
        else:
            status_code = 502
        raise HTTPException(status_code=status_code, detail=str(error)) from error
    except (GeminiJSONError, ValueError) as error:
        raise HTTPException(status_code=502, detail="Feedback generation failed validation. Please retry.") from error
