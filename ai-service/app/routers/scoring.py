from fastapi import APIRouter
from fastapi import HTTPException

from app.models.Scoring_scheme import (
    ScoreRequest
)

from app.services.gemini_client import GeminiAPIError, GeminiJSONError
from app.services.scoring_engine import (
    create_candidate_score
)


router = APIRouter(
    prefix="/score",
    tags=["Scoring"]
)


@router.post("/candidate")
async def score_candidate(
    request: ScoreRequest
):
    try:
        return await create_candidate_score(
            candidate_id=request.candidateId,
            resume_quality=request.resumeQuality,
            github_verification=request.githubVerification,
            skill_match=request.skillMatch,
            experience_relevance=request.experienceRelevance,
            weights=request.weights,
        )
    except (GeminiAPIError, GeminiJSONError, ValueError) as e:
        raise HTTPException(status_code=502, detail=str(e)) from e