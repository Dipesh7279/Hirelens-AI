"""
Pydantic models for the structured resume output.
These enforce the exact schema we force Gemini to return, and let us
validate + retry if the LLM ever drifts from it.
"""
from typing import Any, List, Optional
from pydantic import BaseModel, Field, field_validator


def _none_to_empty(value: Any) -> Any:
    if value is None:
        return ""
    return value


class Education(BaseModel):
    degree: str = ""
    institute: str = ""
    year: str = ""

    @field_validator("degree", "institute", "year", mode="before")
    @classmethod
    def _clean_str(cls, value: Any) -> Any:
        return _none_to_empty(value)


class Experience(BaseModel):
    role: str = ""
    company: str = ""
    duration: str = ""

    @field_validator("role", "company", "duration", mode="before")
    @classmethod
    def _clean_str(cls, value: Any) -> Any:
        return _none_to_empty(value)


class Project(BaseModel):
    title: str = ""
    description: str = ""
    techStack: List[str] = Field(default_factory=list)

    @field_validator("title", "description", mode="before")
    @classmethod
    def _clean_str(cls, value: Any) -> Any:
        return _none_to_empty(value)

    @field_validator("techStack", mode="before")
    @classmethod
    def _clean_stack(cls, value: Any) -> Any:
        if value is None:
            return []
        return value


class ResumeParsed(BaseModel):
    skills: List[str] = Field(default_factory=list)
    education: List[Education] = Field(default_factory=list)
    experience: List[Experience] = Field(default_factory=list)
    projects: List[Project] = Field(default_factory=list)
    githubUsername: Optional[str] = None

    @field_validator("skills", mode="before")
    @classmethod
    def _clean_skills(cls, value: Any) -> Any:
        if value is None:
            return []
        return value

    @field_validator("education", "experience", "projects", mode="before")
    @classmethod
    def _clean_lists(cls, value: Any) -> Any:
        if value is None:
            return []
        if isinstance(value, list):
            return [item for item in value if isinstance(item, (dict, BaseModel))]
        return value


class AuthenticityResult(BaseModel):
    authenticityScore: int = Field(ge=0, le=100)  # Heuristic only; not an authorship verdict.
    flags: List[str] = Field(default_factory=list)


class ResumeParseResponse(BaseModel):
    rawText: str
    parsed: ResumeParsed
    authenticity: AuthenticityResult
    parsingMode: str = "gemini"
