from typing import Dict, Literal, Optional
from pydantic import BaseModel, Field, field_validator


class FeedbackRequest(BaseModel):
    jobTitle: str = Field(min_length=2, max_length=120)
    decision: Literal["selected", "rejected"]
    breakdown: Optional[Dict[str, float]] = None
    interviewNotes: str = Field(default="", max_length=3000)
    hasCompletedInterview: Optional[bool] = Field(default=True)


class FeedbackResponse(BaseModel):
    feedback: str = Field(min_length=1)

    @field_validator("feedback")
    @classmethod
    def enforce_word_count(cls, feedback):
        count = len(feedback.split())
        if not 50 <= count <= 140:
            raise ValueError("Feedback must contain between 50 and 140 words")
        return feedback
