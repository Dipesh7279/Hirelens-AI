import asyncio
import base64
from datetime import datetime, timezone

import pytest

from app.services import github_analyzer
from app.models.github_schema import GitHubAnalysisResponse


def test_github_analysis_caps_public_api_usage_and_discloses_signal(monkeypatch):
    github_analyzer._REQUEST_CACHE.clear()
    calls = []
    recent_date = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    repos = [
        {
            "name": f"repo-{index}", "description": "Sample project", "fork": index == 0,
            "owner": {"login": "public-user"},
            "html_url": f"https://github.com/public-user/repo-{index}",
            "parent": {"html_url": "https://github.com/upstream/repo-0"} if index == 0 else None,
        }
        for index in range(12)
    ]

    async def fake_request(url):
        calls.append(url)
        if "/users/" in url:
            assert "type=owner" in url
            assert f"per_page={github_analyzer.REPOSITORY_FETCH_LIMIT}" in url
            return repos
        if url.endswith("/languages"):
            return {"Python": 75, "HTML": 25}
        if "/commits?" in url:
            assert "per_page=100" in url
            assert "since=" in url
            return [{"commit": {"author": {"date": recent_date}}}]
        if url.endswith("/readme"):
            return {"content": base64.b64encode(b"A useful README " * 40).decode()}
        raise AssertionError(url)

    monkeypatch.setattr(github_analyzer, "github_request", fake_request)
    result = asyncio.run(github_analyzer.analyze_github("public-user"))
    validated = GitHubAnalysisResponse.model_validate(result)
    assert validated.repositories[0].repositoryUrl == "https://github.com/public-user/repo-0"

    assert len(result["repositories"]) == github_analyzer.MAX_REPOSITORIES
    assert len(calls) == 1 + github_analyzer.MAX_REPOSITORIES * 3
    assert result["repositories"][0]["description"] == "Sample project"
    assert result["repositories"][0]["hasRecentCommit"] is True
    assert result["repositories"][0]["recentCommitCount"] == 1
    assert result["repositories"][0]["recentCommitCountCapped"] is False
    assert result["repositories"][0]["activityWindowDays"] == 90
    assert result["repositories"][0]["repositoryUrl"] == "https://github.com/public-user/repo-0"
    assert result["repositories"][0]["ownerLogin"] == "public-user"
    assert result["repositories"][0]["forkedFrom"] == "https://github.com/upstream/repo-0"
    assert "originalityScore" not in result["repositories"][0]
    assert result["analysisLimits"]["repositoryLimit"] == github_analyzer.MAX_REPOSITORIES
    assert result["analysisLimits"]["commitSampleLimit"] == github_analyzer.MAX_COMMITS_PER_REPOSITORY
    assert "not individual user attribution" in result["analysisLimits"]["commitActivityScope"]
    assert result["repositories"][0]["readmeQuality"] == 2
    assert "do not prove" in result["advisoryNotice"]
    assert result["analysisLimits"]["repositoriesTruncated"] is True


def test_commit_activity_uses_a_90_day_window_and_rejects_bad_dates():
    assert github_analyzer._commit_is_recent(datetime.now(timezone.utc).isoformat()) is True
    assert github_analyzer._commit_is_recent("2020-01-01T00:00:00Z") is False
    assert github_analyzer._commit_is_recent("not-a-date") is False


def test_readme_base64_decoding_handles_whitespace_and_invalid_content(monkeypatch):
    async def fake_request(url):
        if "/users/" in url:
            return [{"name": "repo", "fork": False, "owner": {"login": "public-user"}, "html_url": "https://github.com/public-user/repo"}]
        if url.endswith("/languages"):
            return {"Python": 1}
        if "/commits?" in url:
            return []
        if url.endswith("/readme"):
            return {"content": "%%%bad base64%%%"}
        raise AssertionError(url)

    monkeypatch.setattr(github_analyzer, "github_request", fake_request)
    result = asyncio.run(github_analyzer.analyze_github("public-user"))
    assert result["repositories"][0]["readmeQuality"] == 0


def test_recent_commit_sample_discloses_when_count_is_capped(monkeypatch):
    recent_date = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    async def fake_request(url):
        if "/users/" in url:
            return [{"name": "repo", "owner": {"login": "public-user"}, "html_url": "https://github.com/public-user/repo"}]
        if url.endswith("/languages"):
            return {"Python": 1}
        if "/commits?" in url:
            return [{"commit": {"author": {"date": recent_date}}}] * 100
        if url.endswith("/readme"):
            return {}
        raise AssertionError(url)

    monkeypatch.setattr(github_analyzer, "github_request", fake_request)
    result = asyncio.run(github_analyzer.analyze_github("public-user"))
    assert result["repositories"][0]["recentCommitCount"] == 100
    assert result["repositories"][0]["recentCommitCountCapped"] is True


def test_empty_public_profile_returns_explicit_zero_results(monkeypatch):
    async def empty_request(_url):
        return []

    monkeypatch.setattr(github_analyzer, "github_request", empty_request)
    result = asyncio.run(github_analyzer.analyze_github("empty-user"))
    assert result["repositories"] == []
    assert result["skills"] == []
    assert result["analysisLimits"]["repositoriesTruncated"] is False


def test_malformed_repository_metadata_returns_clear_upstream_error(monkeypatch):
    async def malformed_request(url):
        if "/users/" in url:
            return [{"name": "repo", "owner": {}, "html_url": "not-a-url"}]
        raise AssertionError(url)

    monkeypatch.setattr(github_analyzer, "github_request", malformed_request)
    with pytest.raises(github_analyzer.GitHubAPIError, match="invalid repository metadata"):
        asyncio.run(github_analyzer.analyze_github("public-user"))


def test_github_request_maps_rate_limit_and_caches_success(monkeypatch):
    from types import SimpleNamespace

    calls = []

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, url, headers):
            calls.append((url, headers))
            return SimpleNamespace(status_code=200, headers={}, is_error=False, json=lambda: {"ok": True})

    monkeypatch.setattr(github_analyzer.httpx, "AsyncClient", lambda **_kwargs: FakeClient())
    github_analyzer._REQUEST_CACHE.clear()
    url = "https://api.github.com/users/cache-test"
    assert asyncio.run(github_analyzer.github_request(url)) == {"ok": True}
    assert asyncio.run(github_analyzer.github_request(url)) == {"ok": True}
    assert len(calls) == 1

    class RateLimitedClient(FakeClient):
        async def get(self, url, headers):
            return SimpleNamespace(status_code=429, headers={}, is_error=True, json=lambda: {})

    github_analyzer._REQUEST_CACHE.clear()
    monkeypatch.setattr(github_analyzer.httpx, "AsyncClient", lambda **_kwargs: RateLimitedClient())
    with pytest.raises(github_analyzer.GitHubAPIError) as raised:
        asyncio.run(github_analyzer.github_request("https://api.github.com/users/rate-limited"))
    assert raised.value.status_code == 429


def test_github_optional_token_is_only_sent_when_present(monkeypatch):
    from types import SimpleNamespace

    seen_headers = []

    class FakeClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): return None
        async def get(self, _url, headers):
            seen_headers.append(headers)
            return SimpleNamespace(status_code=200, headers={}, is_error=False, json=lambda: {})

    github_analyzer._REQUEST_CACHE.clear()
    monkeypatch.setattr(github_analyzer.httpx, "AsyncClient", lambda **_kwargs: FakeClient())
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    asyncio.run(github_analyzer.github_request("https://api.github.com/users/no-token-test"))
    assert "Authorization" not in seen_headers[-1]

    github_analyzer._REQUEST_CACHE.clear()
    monkeypatch.setenv("GITHUB_TOKEN", "dummy-test-token")
    asyncio.run(github_analyzer.github_request("https://api.github.com/users/token-test"))
    assert seen_headers[-1]["Authorization"] == "Bearer dummy-test-token"


@pytest.mark.parametrize("username", ["../admin", "name?query", "contains space", "", "-bad"])
def test_github_username_validation_rejects_path_injection(username):
    with pytest.raises(github_analyzer.GitHubAPIError) as raised:
        github_analyzer.validate_username(username)
    assert raised.value.status_code == 400


def test_github_rate_limit_is_propagated_instead_of_returning_empty_scores(monkeypatch):
    async def rate_limited(_url):
        raise github_analyzer.GitHubAPIError("rate limited", status_code=429)

    monkeypatch.setattr(github_analyzer, "github_request", rate_limited)
    with pytest.raises(github_analyzer.GitHubAPIError) as raised:
        asyncio.run(github_analyzer.analyze_github("public-user"))
    assert raised.value.status_code == 429
