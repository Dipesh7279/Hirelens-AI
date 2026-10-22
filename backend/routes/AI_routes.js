const express = require("express");
const mongoose = require("mongoose");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");

const router = express.Router();
router.use(requireAuth, requireRole("recruiter", "admin"));

const configuredAiServiceUrl = (
  process.env.AI_SERVICE_URL || "http://localhost:8000"
).replace(/\/+$/, "");
const AI_SERVICE_URL = configuredAiServiceUrl.endsWith("/ai")
  ? configuredAiServiceUrl
  : `${configuredAiServiceUrl}/ai`;

const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || 'hirelens-internal-shared-secret-dev';

async function requestAiService(path, options = {}) {
  const headers = {
    'X-Internal-Secret': INTERNAL_SERVICE_KEY,
    ...(options.headers || {}),
  };
  const response = await fetch(`${AI_SERVICE_URL}${path}`, { ...options, headers });
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.detail || `AI service returned ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return data;
}

function isPublicGitHubUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "github.com" &&
      !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function normalizeGitHubAnalysis(analysis, username) {
  const limits = analysis?.analysisLimits;
  if (analysis?.username !== username || !Array.isArray(analysis.skills) ||
      !Array.isArray(analysis.repositories) || analysis.repositories.length > 10 ||
      !limits || limits.publicRepositoriesOnly !== true ||
      !Number.isInteger(limits.commitWindowDays) || limits.commitWindowDays < 1 ||
      !Number.isInteger(limits.commitSampleLimit) || limits.commitSampleLimit < 1 ||
      !Number.isInteger(limits.repositoryLimit) || limits.repositoryLimit < 1) return null;

  const repositories = [];
  for (const repo of analysis.repositories) {
    if (!repo || typeof repo.name !== "string" || !repo.name.trim() || repo.name.length > 100 ||
        typeof repo.ownerLogin !== "string" || repo.ownerLogin.toLowerCase() !== username.toLowerCase() ||
        !isPublicGitHubUrl(repo.repositoryUrl) || typeof repo.isFork !== "boolean" ||
        !Number.isInteger(repo.recentCommitCount) || repo.recentCommitCount < 0 ||
        !Number.isInteger(repo.activityWindowDays) || repo.activityWindowDays !== limits.commitWindowDays ||
        typeof repo.recentCommitCountCapped !== "boolean" || typeof repo.hasRecentCommit !== "boolean") return null;
    const languages = {};
    if (!repo.languages || typeof repo.languages !== "object" || Array.isArray(repo.languages)) return null;
    for (const [language, percentage] of Object.entries(repo.languages).slice(0, 30)) {
      if (typeof percentage !== "number" || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) return null;
      if (typeof language === "string" && language.trim() && language.length <= 80) languages[language] = percentage;
    }
    const forkedFrom = repo.isFork && isPublicGitHubUrl(repo.forkedFrom) ? repo.forkedFrom : null;
    repositories.push({
      name: repo.name.trim(),
      description: typeof repo.description === "string" ? repo.description.slice(0, 500) : "",
      repositoryUrl: repo.repositoryUrl,
      ownerLogin: repo.ownerLogin,
      languages,
      activityWindowDays: repo.activityWindowDays,
      recentCommitCount: Math.min(repo.recentCommitCount, limits.commitSampleLimit),
      recentCommitCountCapped: repo.recentCommitCountCapped,
      hasRecentCommit: repo.hasRecentCommit,
      lastCommit: typeof repo.lastCommit === "string" && Number.isFinite(Date.parse(repo.lastCommit)) ? repo.lastCommit : null,
      isFork: repo.isFork,
      forkedFrom,
      forksCount: Number.isInteger(repo.forksCount) && repo.forksCount >= 0 ? repo.forksCount : 0,
    });
  }
  const skills = [...new Set(analysis.skills
    .filter((skill) => typeof skill === "string")
    .map((skill) => skill.trim())
    .filter((skill) => skill.length > 0 && skill.length <= 80))].slice(0, 50);

  return {
    username,
    skills,
    repositories,
    analysisLimits: {
      publicRepositoriesOnly: true,
      repositoryLimit: limits.repositoryLimit,
      repositoriesTruncated: limits.repositoriesTruncated === true,
      commitWindowDays: limits.commitWindowDays,
      commitSampleLimit: limits.commitSampleLimit,
      commitActivityScope: typeof limits.commitActivityScope === "string" ? limits.commitActivityScope.slice(0, 240) : "",
    },
    advisoryNotice: typeof analysis.advisoryNotice === "string" ? analysis.advisoryNotice.slice(0, 500) : "Public GitHub data is advisory only and does not prove identity, skill, or ownership.",
  };
}


// -------------------------
// MODULE 3
// GitHub Analysis
// -------------------------

router.get(
  "/github/:username/analyze",
  async (req, res) => {

    try {

      const username =
        req.params.username;

      const result = await requestAiService(
        `/github/${encodeURIComponent(username)}/analyze`
      );
      res.json(result);

    } catch (error) {

      const status = [400, 404, 429, 502, 504].includes(error.status) ? error.status : 502;
      res.status(status).json({ error: error.message || "GitHub analysis failed" });
    }
  }
);


// -------------------------
// MODULE 3
// Skill Matching
// -------------------------

router.post(
  "/github/match",
  async (req, res) => {

    try {

      const result = await requestAiService("/github/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      res.json(result);

    } catch (error) {

      const status = error.status === 503 ? 503 : 502;
      res.status(status).json({ error: error.message || "Skill matching failed" });
    }
  }
);


// -------------------------
// MODULE 4
// Candidate Scoring
// -------------------------
const CandidateProfile = require("../models/CandidateProfile");
const Job = require("../models/Job");
const JobApplication = require("../models/JobApplication");

// Save a GitHub analysis result onto a candidate's profile
router.post("/github/save/:candidateId", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.candidateId)) {
      return res.status(400).json({ error: "Invalid candidate ID" });
    }
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username)) {
      return res.status(400).json({ error: "Invalid GitHub username" });
    }

    // A GitHub save may update an existing candidate profile, never create one.
    const profile = await CandidateProfile.findOne({ candidateId: req.params.candidateId });
    if (!profile) return res.status(404).json({ error: "Candidate profile not found" });

    if (req.user.role !== "admin" && String(profile.uploadedBy) !== String(req.user.sub)) {
      const jobs = await Job.find({ recruiterId: req.user.sub }).select("_id").lean();
      const hasApplied = jobs.length > 0 && await JobApplication.exists({
        candidateId: req.params.candidateId,
        jobId: { $in: jobs.map((job) => job._id) },
      });
      if (!hasApplied) return res.status(403).json({ error: "Not authorized to update this candidate profile" });
    }

    // Re-fetch canonical public data; never persist client-submitted skills or scores.
    const analysis = await requestAiService(`/github/${encodeURIComponent(username)}/analyze`);
    const canonicalAnalysis = normalizeGitHubAnalysis(analysis, username);
    if (!canonicalAnalysis) {
      return res.status(502).json({ error: "GitHub analysis returned invalid data" });
    }
    profile.github = {
      ...canonicalAnalysis,
      analyzedBy: req.user.sub,
      analyzedAt: new Date(),
    };

    if (Array.isArray(profile.resume?.skills) && profile.resume.skills.length > 0 && Array.isArray(canonicalAnalysis.skills) && canonicalAnalysis.skills.length > 0) {
      try {
        const matchData = await requestAiService("/github/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resumeSkills: profile.resume.skills,
            githubSkills: canonicalAnalysis.skills,
          }),
        });
        if (matchData && Array.isArray(matchData.matches)) {
          profile.skillMatch = {
            score: typeof matchData.score === "number" ? matchData.score : 0,
            matches: matchData.matches,
            computedAt: new Date(),
          };
        }
      } catch {
        // Non-fatal if AI skill matching service is busy
      }
    }

    await profile.save();
    res.json(profile);
  } catch (err) { next(err); }
});

// Candidate scoring
router.post("/score/candidate", async (req, res, next) => {
  try {
    const result = await requestAiService("/score/candidate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    res.json(result);
  } catch (error) {
    res.status(502).json({
      message: error.message || "Candidate scoring failed"
    });
  }
});


module.exports = router;
