from fastapi.concurrency import run_in_threadpool
from app.services.gemini_client import GeminiAPIError, call_gemini_json

DEFAULT_WEIGHTS = {
    "resumeQuality": 0.20,
    # GitHub activity is optional/unevenly available and is not identity or skill verification.
    # GitHub remains visible as advisory context but is never a scoring input.
    "githubVerification": 0.0,
    "skillMatch": 0.35,
    "experienceRelevance": 0.15
}


def _get_effective_weights(weights):
    if weights is None:
        weights = {}
    if not isinstance(weights, dict):
        raise ValueError("Score weights must be an object")

    unknown = set(weights) - set(DEFAULT_WEIGHTS)
    if unknown:
        raise ValueError(f"Unknown score weight keys: {', '.join(sorted(unknown))}")
    if any(not isinstance(value, (int, float)) or not 0 <= value <= 1 for value in weights.values()):
        raise ValueError("Each score weight must be between 0 and 1")
    if weights.get("githubVerification", 0) > 0:
        raise ValueError("GitHub evidence cannot affect candidate scores")
    normalized_weights = DEFAULT_WEIGHTS.copy()
    normalized_weights.update(weights)
    total = sum(normalized_weights.values())
    if total <= 0:
        raise ValueError("At least one score weight must be greater than zero")
    return {key: value / total for key, value in normalized_weights.items()}


def calculate_score(
    resume_quality,
    github_verification,
    skill_match,
    experience_relevance,
    weights=None
):

    effective_weights = _get_effective_weights(weights)

    score = (
        resume_quality
        * effective_weights["resumeQuality"]
        +

        github_verification
        * effective_weights["githubVerification"]
        +

        skill_match
        * effective_weights["skillMatch"]
        +

        experience_relevance
        * effective_weights["experienceRelevance"]
    )

    return round(score, 2)


async def generate_explanation(
    breakdown,
    score
):
    prompt = f"""
Explain the following candidate score in 3-4 simple sentences.

Candidate score: {score}/100
Breakdown: {breakdown}

Only use the numbers provided. Do not infer gender, age, ethnicity, or
personal characteristics. Do not add categories that are not present.
Return only JSON in this shape: {{"explanation": "..."}}
"""
    try:
        raw = await run_in_threadpool(
            call_gemini_json,
            "You are an unbiased recruitment analyst.",
            prompt,
        )
        explanation = raw.get("explanation") if isinstance(raw, dict) else None
        if isinstance(explanation, str) and explanation.strip():
            return explanation.strip()
        raise ValueError("Gemini returned no score explanation")
    except GeminiAPIError:
        # Fallback when Gemini API key is not configured or network unavailable
        rq = breakdown.get("resumeQuality", 0)
        gv = breakdown.get("githubVerification", 0)
        sm = breakdown.get("skillMatch", 0)
        er = breakdown.get("experienceRelevance", 0)
        return (
            f"Candidate achieved an overall weighted score of {score}/100 across evaluated components: "
            f"resume quality ({rq}%), GitHub activity (advisory only: {gv}%), skill match ({sm}%), and experience relevance ({er}%). "
            f"Calculations follow configured component weights without demographic inference."
        )


async def create_candidate_score(
    candidate_id,
    resume_quality,
    github_verification,
    skill_match,
    experience_relevance,
    weights=None
):

    effective_weights = _get_effective_weights(weights)

    breakdown = {
        "resumeQuality": resume_quality,
        "githubVerification":
            github_verification,
        "skillMatch": skill_match,
        "experienceRelevance":
            experience_relevance
    }

    score = calculate_score(
        resume_quality,
        github_verification,
        skill_match,
        experience_relevance,
        effective_weights
    )

    explanation = await generate_explanation(
        breakdown,
        score
    )

    return {
        "candidateId": candidate_id,
        "weightedScore": score,
        "breakdown": breakdown,
        "weights": effective_weights,
        "explanation": explanation,
        "biasAuditStatus": "not_performed",
        "biasAuditFlags": [],
    }
