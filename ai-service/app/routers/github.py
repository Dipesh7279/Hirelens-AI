from fastapi import APIRouter, HTTPException

from app.models.github_schema import (
    GitHubAnalysisResponse,
    SkillMatchRequest,
    SkillMatchResponse,
)

from app.services.github_analyzer import (
    analyze_github
)
from app.services.github_analyzer import GitHubAPIError

from app.services.skill_matcher import (
    match_skills,
    SkillMatcherUnavailable,
)


router = APIRouter(
    prefix="/github",
    tags=["GitHub"]
)


@router.get("/{username}/analyze", response_model=GitHubAnalysisResponse)
async def analyze(username: str):
    try:
        result = await analyze_github(username)
        return result
    except GitHubAPIError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail="GitHub analysis failed",
        ) from e


@router.post("/match", response_model=SkillMatchResponse)
async def match(request: SkillMatchRequest):
    try:
        return match_skills(request.resumeSkills, request.githubSkills)
    except SkillMatcherUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
