import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.services import skill_matcher

client = TestClient(app)


def test_match_skills_encodes_lists_once_and_returns_best_matches(monkeypatch):
    class FakeModel:
        def __init__(self):
            self.encoded = []

        def encode(self, skills):
            self.encoded.append(skills)
            return skills

    model = FakeModel()
    similarities = np.array([[0.8, 0.1], [0.2, 0.95]])
    monkeypatch.setattr(
        skill_matcher,
        "_load_model",
        lambda: (model, lambda resume, github: similarities),
    )

    result = skill_matcher.match_skills(
        ["Python", "React"],
        ["Python API development", "React UI development"],
    )

    assert model.encoded == [
        ["Python", "React"],
        ["Python API development", "React UI development"],
    ]
    assert result == {
        "score": 87.5,
        "matches": [
            {
                "resumeSkill": "Python",
                "githubSkill": "Python API development",
                "similarity": 80.0,
            },
            {
                "resumeSkill": "React",
                "githubSkill": "React UI development",
                "similarity": 95.0,
            },
        ],
    }


def test_match_skills_handles_empty_inputs():
    assert skill_matcher.match_skills([], ["Python"]) == {"score": 0, "matches": []}
    assert skill_matcher.match_skills(["Python"], []) == {"score": 0, "matches": []}


def test_match_skills_route(monkeypatch):
    class FakeModel:
        def encode(self, skills):
            return skills

    similarities = np.array([[0.9]])
    monkeypatch.setattr(
        skill_matcher,
        "_load_model",
        lambda: (FakeModel(), lambda r, g: similarities),
    )

    response = client.post(
        "/ai/github/match",
        json={"resumeSkills": ["FastAPI"], "githubSkills": ["Python"]},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["score"] == 90.0
    assert data["matches"] == [
        {"resumeSkill": "FastAPI", "githubSkill": "Python", "similarity": 90.0}
    ]
