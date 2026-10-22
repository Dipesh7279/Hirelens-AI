from typing import List, Literal, Optional
from pydantic import BaseModel, Field, field_validator


def _clean_string_list(values, max_item_length: int) -> List[str]:
    if not isinstance(values, list):
        return values
    cleaned: List[str] = []
    seen = set()
    for item in values:
        if not isinstance(item, str):
            raise ValueError("List items must be strings")
        trimmed = item.strip()
        if not trimmed:
            continue
        if len(trimmed) > max_item_length:
            raise ValueError(f"Item exceeds maximum length of {max_item_length} characters")
        key = trimmed.casefold()
        if key not in seen:
            seen.add(key)
            cleaned.append(trimmed)
    return cleaned


class QuestionRequest(BaseModel):
    jobTitle: str = Field(min_length=2, max_length=120)
    jobDescription: Optional[str] = Field(default="", max_length=4000)
    verifiedSkills: List[str] = Field(min_length=1, max_length=30)
    projectTitles: List[str] = Field(default_factory=list, max_length=10)
    githubRepositories: List[str] = Field(default_factory=list, max_length=15)

    @field_validator("jobTitle", mode="before")
    @classmethod
    def _strip_job_title(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("verifiedSkills", mode="before")
    @classmethod
    def _validate_skills(cls, value):
        return _clean_string_list(value, max_item_length=60)

    @field_validator("projectTitles", "githubRepositories", mode="before")
    @classmethod
    def _validate_projects(cls, value):
        if value is None:
            return []
        return _clean_string_list(value, max_item_length=120)


class InterviewQuestion(BaseModel):
    type: Literal["technical", "project", "behavioral"]
    question: str = Field(min_length=1, max_length=500)
    expectedFocus: str = Field(min_length=1, max_length=400)

    @field_validator("question", "expectedFocus", mode="before")
    @classmethod
    def _strip_text(cls, value):
        return value.strip() if isinstance(value, str) else value


class QuestionResponse(BaseModel):
    questions: List[InterviewQuestion]


class FrameAnalysis(BaseModel):
    faceCount: int
    phoneDetected: bool
    confidence: float  # best phone confidence (0 if none)
    lookingAway: bool = False
    yawRatio: float = 0.0
    pitchRatio: float = 0.0
    attentionAvailable: bool = False
    phoneCheckAvailable: bool = True
