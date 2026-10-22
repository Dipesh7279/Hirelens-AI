from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional

WEIGHT_KEYS = {
    "resumeQuality",
    "githubVerification",
    "skillMatch",
    "experienceRelevance",
}


class ScoreRequest(BaseModel):

    model_config = ConfigDict(extra="forbid")

    candidateId: str

    resumeQuality: float = Field(ge=0, le=100, allow_inf_nan=False)
    githubVerification: float = Field(ge=0, le=100, allow_inf_nan=False)
    skillMatch: float = Field(ge=0, le=100, allow_inf_nan=False)
    experienceRelevance: float = Field(ge=0, le=100, allow_inf_nan=False)

    weights: Optional[dict[str, float]] = None

    @field_validator("weights")
    @classmethod
    def validate_weights(cls, weights):
        if weights is None:
            return weights
        unknown = set(weights) - WEIGHT_KEYS
        if unknown:
            raise ValueError(f"Unknown score weight keys: {', '.join(sorted(unknown))}")
        if weights.get("githubVerification", 0) > 0:
            raise ValueError("GitHub evidence cannot affect candidate scores")
        if any(not 0 <= weight <= 1 for weight in weights.values()):
            raise ValueError("Each score weight must be between 0 and 1")
        if not any(weight > 0 for weight in weights.values()):
            raise ValueError("At least one score weight must be greater than zero")
        return weights


class ScoreResponse(BaseModel):

    candidateId: str

    weightedScore: float

    breakdown: dict

    weights: dict

    explanation: Optional[str] = None
