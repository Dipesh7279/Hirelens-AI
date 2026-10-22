"""Bounded, advisory analysis of public GitHub repository metadata."""
import asyncio
import base64
import os
import re
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx

GITHUB_API = "https://api.github.com"
MAX_REPOSITORIES = 10
REPOSITORY_FETCH_LIMIT = MAX_REPOSITORIES + 1  # detect whether the display is truncated
MAX_COMMITS_PER_REPOSITORY = 100
REQUEST_TIMEOUT_SECONDS = 10
RECENT_COMMIT_WINDOW_DAYS = 90
_CACHE_TTL_SECONDS = 300
_MAX_CACHE_ENTRIES = 256
_REQUEST_CACHE = {}
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")


class GitHubAPIError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def validate_username(username: str) -> str:
    if not isinstance(username, str) or not USERNAME_PATTERN.fullmatch(username):
        raise GitHubAPIError("Invalid GitHub username", status_code=400)
    return username


async def github_request(url: str):
    now = time.monotonic()
    cached = _REQUEST_CACHE.get(url)
    if cached and cached[0] > now:
        return cached[1]

    token = os.getenv("GITHUB_TOKEN")
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS, follow_redirects=False) as client:
            response = await client.get(url, headers=headers)
    except httpx.TimeoutException as error:
        raise GitHubAPIError("GitHub API timed out", status_code=504) from error
    except httpx.HTTPError as error:
        raise GitHubAPIError("GitHub API request failed", status_code=502) from error

    if response.status_code == 404:
        raise GitHubAPIError("GitHub user or repository was not found", status_code=404)
    if response.status_code == 403 and response.headers.get("X-RateLimit-Remaining") == "0":
        raise GitHubAPIError("GitHub public API rate limit reached; try again later", status_code=429)
    if response.status_code == 429:
        raise GitHubAPIError("GitHub public API rate limit reached; try again later", status_code=429)
    if response.is_error:
        raise GitHubAPIError(f"GitHub API returned HTTP {response.status_code}", status_code=502)
    try:
        data = response.json()
    except (ValueError, TypeError) as error:
        raise GitHubAPIError("GitHub returned malformed JSON") from error

    if len(_REQUEST_CACHE) >= _MAX_CACHE_ENTRIES:
        oldest_key = min(_REQUEST_CACHE, key=lambda key: _REQUEST_CACHE[key][0])
        _REQUEST_CACHE.pop(oldest_key, None)
    _REQUEST_CACHE[url] = (now + _CACHE_TTL_SECONDS, data)
    return data


def _commit_date(commit):
    if not isinstance(commit, dict):
        return None
    nested = commit.get("commit")
    if not isinstance(nested, dict):
        return None
    author = nested.get("author")
    return author.get("date") if isinstance(author, dict) else None


def _commit_is_recent(commit_date, now=None):
    if not commit_date:
        return False
    try:
        parsed = datetime.fromisoformat(commit_date.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        now = now or datetime.now(timezone.utc)
        return now - timedelta(days=RECENT_COMMIT_WINDOW_DAYS) <= parsed <= now
    except (AttributeError, TypeError, ValueError):
        return False


async def _analyze_repo(repo: dict, since: str, now: datetime):
    name = repo["name"]
    owner = repo["owner"]["login"]
    encoded_owner = quote(owner, safe="")
    encoded_name = quote(name, safe="")
    base = f"{GITHUB_API}/repos/{encoded_owner}/{encoded_name}"

    languages, commits, readme = await asyncio.gather(
        github_request(f"{base}/languages"),
        github_request(f"{base}/commits?per_page={MAX_COMMITS_PER_REPOSITORY}&since={quote(since, safe='')}"),
        github_request(f"{base}/readme"),
        return_exceptions=True,
    )

    for result in (languages, commits, readme):
        if isinstance(result, GitHubAPIError) and result.status_code == 429:
            raise result
    if isinstance(languages, Exception) or not isinstance(languages, dict):
        languages = {}
    languages = {
        language: amount for language, amount in languages.items()
        if isinstance(language, str) and isinstance(amount, (int, float))
        and not isinstance(amount, bool) and amount >= 0
    }
    if isinstance(commits, Exception) or not isinstance(commits, list):
        commits = []
    if isinstance(readme, Exception) or not isinstance(readme, dict):
        readme = {}

    total_bytes = sum(languages.values()) or 1
    language_percentage = {language: round((amount / total_bytes) * 100, 2) for language, amount in languages.items()}
    dated_commits = [(entry, _commit_date(entry)) for entry in commits]
    recent_commits = [(entry, date) for entry, date in dated_commits if _commit_is_recent(date, now)]
    last_commit = next((date for _entry, date in dated_commits if date), None)

    try:
        encoded_readme = re.sub(r"\s+", "", readme.get("content", ""))
        readme_text = base64.b64decode(encoded_readme, validate=True).decode("utf-8", errors="replace")
    except (ValueError, TypeError):
        readme_text = ""
    readme_quality = min(10, len(readme_text.strip()) // 250)

    parent = repo.get("parent")
    forked_from = parent.get("html_url") if isinstance(parent, dict) else None
    return {
        "name": name,
        "description": repo.get("description") or "",
        "repositoryUrl": repo["html_url"],
        "ownerLogin": owner,
        "languages": language_percentage,
        "activityWindowDays": RECENT_COMMIT_WINDOW_DAYS,
        "recentCommitCount": len(recent_commits),
        "recentCommitCountCapped": len(commits) >= MAX_COMMITS_PER_REPOSITORY,
        "hasRecentCommit": bool(recent_commits),
        "lastCommit": last_commit,
        "isFork": bool(repo.get("fork")),
        "forkedFrom": forked_from if repo.get("fork") else None,
        "forksCount": repo.get("forks_count") if isinstance(repo.get("forks_count"), int) else 0,
        "readmeQuality": readme_quality,
    }


async def analyze_github(username: str):
    username = validate_username(username)
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=RECENT_COMMIT_WINDOW_DAYS)).isoformat().replace("+00:00", "Z")
    encoded_username = quote(username, safe="")
    repos = await github_request(
        f"{GITHUB_API}/users/{encoded_username}/repos?type=owner&per_page={REPOSITORY_FETCH_LIMIT}&sort=updated"
    )
    if not isinstance(repos, list) or any(
        not isinstance(repo, dict)
        or not isinstance(repo.get("name"), str)
        or not isinstance(repo.get("owner"), dict)
        or not isinstance(repo["owner"].get("login"), str)
        or not isinstance(repo.get("html_url"), str)
        or not repo["html_url"].startswith("https://github.com/")
        for repo in repos
    ):
        raise GitHubAPIError("GitHub returned invalid repository metadata")

    truncated = len(repos) > MAX_REPOSITORIES
    repository_data = await asyncio.gather(*(
        _analyze_repo(repo, since, now) for repo in repos[:MAX_REPOSITORIES]
    ))
    language_counter = Counter()
    for repo in repository_data:
        language_counter.update(repo["languages"].keys())

    return {
        "username": username,
        "repositories": repository_data,
        "skills": [language for language, _count in language_counter.most_common(10)],
        "analysisLimits": {
            "publicRepositoriesOnly": True,
            "repositoryLimit": MAX_REPOSITORIES,
            "repositoriesTruncated": truncated,
            "commitWindowDays": RECENT_COMMIT_WINDOW_DAYS,
            "commitSampleLimit": MAX_COMMITS_PER_REPOSITORY,
            "commitActivityScope": "Repository-wide commits on the default branch; not individual user attribution.",
        },
        "advisoryNotice": "Public GitHub metadata is advisory only; fork status and activity do not prove identity, authorship, skill, or work ownership.",
    }
