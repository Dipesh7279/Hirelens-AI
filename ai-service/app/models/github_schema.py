from pydantic import BaseModel
from typing import List, Dict, Optional


class GitHubAnalysisRequest(BaseModel):
    username: str


class RepositoryInfo(BaseModel):
    name: str
    description: str = ""
    repositoryUrl: str
    ownerLogin: str
    languages: Dict[str, float] = {}
    activityWindowDays: int = 90
    recentCommitCount: int = 0
    recentCommitCountCapped: bool = False
    hasRecentCommit: bool = False
    lastCommit: Optional[str] = None
    isFork: bool = False
    forkedFrom: Optional[str] = None
    forksCount: int = 0
    readmeQuality: float = 0


class GitHubAnalysisResponse(BaseModel):
    username: str
    repositories: List[RepositoryInfo]
    skills: List[str]
    analysisLimits: Dict[str, object]
    advisoryNotice: str


class SkillMatchRequest(BaseModel):
    resumeSkills: List[str]
    githubSkills: List[str]


class SkillMatchItem(BaseModel):
    resumeSkill: str
    githubSkill: str
    similarity: float


class SkillMatchResponse(BaseModel):
    score: float
    matches: List[SkillMatchItem]
