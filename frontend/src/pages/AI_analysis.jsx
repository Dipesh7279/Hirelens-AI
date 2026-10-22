import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/axiosInstance";

const tabs = [
  "GitHub Analysis",
  "Skill Matching",
  "Candidate Score",
];

export default function AIAnalysis() {
  const [tab, setTab] = useState(tabs[0]);
  const [username, setUsername] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [githubSaved, setGithubSaved] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState("");
  const [resumeSkills, setResumeSkills] = useState("");
  const [githubData, setGithubData] = useState(null);
  const [matchData, setMatchData] = useState(null);
  const [scoreData, setScoreData] = useState(null);
  const [scores, setScores] = useState({
    resumeQuality: 0,
    githubVerification: 0,
    skillMatch: 0,
    experienceRelevance: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/jobs")
      .then(({ data }) => {
        setJobs(data);
        if (data[0]) setJobId((current) => current || data[0]._id);
      })
      .catch(() => {
        if (tab === "Candidate Score") {
          setError("Could not load your jobs. Create a job from Candidates first.");
        }
      });
  }, [tab]);

  const runAction = async (action) => {
    setLoading(true);
    setError("");

    try {
      await action();
    } catch (err) {
      const status = err.response?.status;
      setError(
        status === 429
          ? "GitHub's public API rate limit was reached. Please wait and try again, or configure an optional GitHub token for a higher limit."
          : err.response?.data?.error ||
          err.response?.data?.message ||
          err.response?.data?.detail ||
          err.message ||
          "Request failed. Check your backend."
      );
    } finally {
      setLoading(false);
    }
  };

  const analyzeGithub = () =>
    runAction(async () => {
      if (!username.trim()) throw new Error("Enter a GitHub username.");

      const { data } = await api.get(
        `/ai/github/${encodeURIComponent(username.trim())}/analyze`
      );

      setGithubData(data);
      setGithubSaved(false);
      setMatchData(null);
      setScoreData(null);
    });

  const matchSkills = () =>
    runAction(async () => {
      if (!githubData) {
        throw new Error("Run GitHub Analysis first.");
      }

      const resume = resumeSkills
        .split(",")
        .map((skill) => skill.trim())
        .filter(Boolean);

      const { data } = await api.post("/ai/github/match", {
        resumeSkills: resume,
        githubSkills: githubData.skills || [],
      });

      setMatchData(data);
      if (typeof data?.score === 'number') {
        setScores((old) => ({
          ...old,
          skillMatch: Math.round(data.score),
        }));
      }
      setScoreData(null);
    });

  const calculateScore = () =>
    runAction(async () => {
      if (!candidateId.trim() || !jobId) {
        throw new Error("Select a job and enter the candidate ID before calculating a score.");
      }

      const { data } = await api.post("/ai/score/candidate", {
        candidateId: candidateId.trim(),
        ...scores,
      });

      await api.post(`/jobs/${jobId}/scores`, data);
      setScoreData(data);
    });

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <Link
          to="/recruiter/dashboard"
          className="inline-flex rounded-lg text-sm text-blue-300 hover:text-blue-200 hover:underline"
        >
          ← Back to recruiter dashboard
        </Link>

        <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">
          AI Recruitment Platform
        </p>

        <h1 className="mt-2 text-3xl font-bold">
          GitHub Analysis & AI Scoring
        </h1>

        <p className="mt-2 text-slate-400">
          Analyze repositories, compare skills, and calculate an
          explainable candidate score.
        </p>

        {/* Navigation tabs */}
        <div className="mt-8 flex flex-wrap gap-2 border-b border-slate-800 pb-4">
          {tabs.map((item) => (
            <button
              key={item}
              onClick={() => {
                setTab(item);
                setError("");
              }}
              className={`rounded-xl px-4 py-3 text-sm font-semibold ${
                tab === item
                  ? "bg-blue-600 text-white"
                  : "bg-slate-900 text-slate-400 hover:bg-slate-800"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"
          >
            {error}
          </div>
        )}

        {loading && (
          <p className="mt-5 text-sm text-blue-400">
            Processing request...
          </p>
        )}

        {/* SECTION 1: GITHUB ANALYSIS */}
        {tab === "GitHub Analysis" && (
          <section className="mt-6 space-y-6">
            <Panel title="Analyze GitHub repositories">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  analyzeGithub();
                }}
                className="flex flex-col gap-3 sm:flex-row"
              >
                <input
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setGithubData(null);
                    setMatchData(null);
                    setScoreData(null);
                  }}
                  placeholder="GitHub username"
                  className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
                />

                <button
                  disabled={loading}
                  className="rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500 disabled:opacity-50"
                >
                  Analyze GitHub
                </button>
              </form>
              {githubData && (
                <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
                  <label className="block text-sm text-slate-300">
                    Candidate ID to save this analysis
                    <input
                      value={candidateId}
                      onChange={(event) => { setCandidateId(event.target.value); setGithubSaved(false); }}
                      placeholder="Candidate record ID"
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={loading || !candidateId.trim() || githubSaved}
                    onClick={() => runAction(async () => {
                      await api.post(`/ai/github/save/${candidateId.trim()}`, {
                        username: githubData.username,
                      });
                      setGithubSaved(true);
                    })}
                    className="rounded-xl border border-emerald-500/40 px-4 py-2 text-sm font-semibold text-emerald-300 disabled:opacity-50"
                  >
                    {githubSaved ? "Saved to candidate profile" : "Save analysis to profile"}
                  </button>
                </div>
              )}
            </Panel>

            {githubData && (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat
                    label="GitHub username"
                    value={githubData.username}
                  />
                  <Stat
                    label="Repositories analyzed"
                    value={(githubData.repositories || []).length}
                  />
                  <Stat
                    label="Languages found"
                    value={(githubData.skills || []).length}
                  />
                  <Stat
                    label="Commit activity window"
                    value={`${githubData.analysisLimits?.commitWindowDays ?? 90} days`}
                  />
                </div>
                <p className="text-sm text-amber-200">
                  {githubData.advisoryNotice || 'Public GitHub metadata is advisory only; it does not prove identity, authorship, skill, or work ownership.'}
                </p>
                <p className="text-xs text-slate-400">
                  Showing up to {githubData.analysisLimits?.repositoryLimit ?? 10} public repositories, newest activity first. Commit counts cover the default branch and are repository-wide, not attributed to this person; each repository is capped at {githubData.analysisLimits?.commitSampleLimit ?? 100} observed commits per {githubData.analysisLimits?.commitWindowDays ?? 90}-day window.
                  {githubData.analysisLimits?.repositoriesTruncated ? ' Additional public repositories were not included in this analysis.' : ''}
                </p>

                <Panel title="Languages found in repositories">
                  <div className="flex flex-wrap gap-2">
                    {(githubData.skills || []).map((skill) => (
                      <span
                        key={skill}
                        className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300"
                      >
                        {skill}
                      </span>
                    ))}

                    {!githubData.skills?.length && (
                      <p className="text-sm text-slate-400">
                        No repository languages were returned.
                      </p>
                    )}
                  </div>
                </Panel>

                <Panel title="Repository analysis">
                  <div className="space-y-3">
                    {(githubData.repositories || []).map((repo) => (
                      <div
                        key={repo.name}
                        className="rounded-xl border border-slate-800 bg-slate-950 p-4"
                      >
                        <div className="flex flex-wrap justify-between gap-3">
                          <div>
                            <h3 className="font-semibold">
                              {repo.name}
                            </h3>
                            <p className="mt-1 text-sm text-slate-400">
                              {repo.description || "No description"}
                            </p>
                          </div>

                          <span className="text-sm text-blue-400">
                            {repo.recentCommitCount} observed commit{repo.recentCommitCount === 1 ? '' : 's'} in {repo.activityWindowDays} days{repo.recentCommitCountCapped ? ' (sample cap reached)' : ''}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                          <Info
                            label="Latest observed commit"
                            value={formatDate(repo.lastCommit)}
                          />
                          <Info
                            label="Repository owner"
                            value={repo.ownerLogin}
                          />
                          <Info
                            label="Marked as a fork by GitHub"
                            value={repo.isFork ? "Yes" : "No"}
                          />
                        </div>

                        {repo.isFork && safeGitHubUrl(repo.forkedFrom) && (
                          <p className="mt-3 text-xs text-slate-400">
                            GitHub lists this as a fork of{' '}
                            <a href={safeGitHubUrl(repo.forkedFrom)} target="_blank" rel="noreferrer" className="text-blue-300 hover:underline">
                              {repo.forkedFrom} ↗
                            </a>
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2">
                          {Object.keys(repo.languages || {}).map(
                            (language) => (
                              <span
                                key={language}
                                className="rounded-md bg-slate-800 px-2 py-1 text-xs"
                              >
                                {language}
                              </span>
                            )
                          )}
                        </div>

                        {safeGitHubUrl(repo.repositoryUrl) && (
                          <a
                            href={safeGitHubUrl(repo.repositoryUrl)}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-4 inline-block text-sm text-blue-400 hover:underline"
                          >
                            View repository ↗
                          </a>
                        )}
                      </div>
                    ))}

                    {!githubData.repositories?.length && (
                      <p className="text-sm text-slate-400">
                        No public repositories were found for this account.
                      </p>
                    )}
                  </div>
                </Panel>
              </>
            )}
          </section>
        )}

        {/* SECTION 2: SKILL MATCHING */}
        {tab === "Skill Matching" && (
          <section className="mt-6 space-y-6">
            <Panel title="Compare resume skills with GitHub">
              <label className="mb-2 block text-sm text-slate-400">
                Resume skills (comma-separated)
              </label>

              <textarea
                rows={3}
                value={resumeSkills}
                onChange={(e) => {
                  setResumeSkills(e.target.value);
                  setMatchData(null);
                  setScoreData(null);
                }}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
              />

              <p className="mt-3 text-sm text-slate-400">
                GitHub analysis must be completed first.
              </p>

              <button
                onClick={matchSkills}
                disabled={loading || !githubData}
                className="mt-4 rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Match Skills
              </button>
            </Panel>

            {matchData && (
              <>
                <Stat
                  label="Average text similarity (not skill verification)"
                  value={`${Number(matchData.score || 0).toFixed(2)}%`}
                />

                <Panel title="Matched skills">
                  <div className="space-y-3">
                    {(matchData.matches || []).map((match, index) => {
                      const evidence = (githubData.repositories || []).filter(
                        (repo) => Object.hasOwn(repo.languages || {}, match.githubSkill) && safeGitHubUrl(repo.repositoryUrl)
                      );
                      return (
                        <div key={index} className="rounded-lg border border-slate-800 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span className="text-slate-200">{match.resumeSkill}</span>
                            <span className="text-slate-400">matches</span>
                            <span className="text-emerald-300">{match.githubSkill}</span>
                            <span className="font-semibold text-blue-300">
                              {Number(match.similarity || 0).toFixed(2)}% text similarity
                            </span>
                          </div>
                          <div className="mt-3 border-t border-slate-800 pt-3 text-xs text-slate-400">
                            <p className="mb-2 font-medium text-slate-300">Public repository evidence for {match.githubSkill}</p>
                            {evidence.length ? (
                              <ul className="flex flex-wrap gap-x-4 gap-y-2">
                                {evidence.map((repo) => (
                                  <li key={repo.name}>
                                    <a
                                      href={safeGitHubUrl(repo.repositoryUrl)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-blue-300 hover:underline"
                                    >
                                      {repo.name} ({repo.languages[match.githubSkill]}% of detected language bytes) ↗
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p>No direct repository-language evidence for this match; similarity is only a text-based suggestion.</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {!matchData.matches?.length && (
                      <p className="text-sm text-slate-400">No comparable skills were found. Add resume skills and try again.</p>
                    )}
                  </div>
                </Panel>
                <p className="text-sm text-amber-200">
                  Language evidence only shows that GitHub reports a language in a public repository. It does not establish who wrote the code or prove proficiency.
                </p>

              </>
            )}
          </section>
        )}

        {/* SECTION 3: CANDIDATE SCORE */}
        {tab === "Candidate Score" && (
          <section className="mt-6 space-y-6">
            <Panel title="Candidate scoring">
              <p className="mb-5 text-sm text-slate-400">
                Select the job this score belongs to, then enter the candidate ID and scores.
                Saved scores appear in Ranked Candidates.
              </p>

              <label className="mb-5 block text-sm text-slate-300">
                Job
                <select
                  value={jobId}
                  onChange={(event) => { setJobId(event.target.value); setScoreData(null); }}
                  disabled={!jobs.length}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
                >
                  {!jobs.length && <option value="">No jobs available — create one from Candidates</option>}
                  {jobs.map((job) => <option key={job._id} value={job._id}>{job.title}</option>)}
                </select>
              </label>

              <label className="mb-5 block text-sm text-slate-300">
                Candidate ID
                <input
                  value={candidateId}
                  onChange={(event) => {
                    setCandidateId(event.target.value);
                    setScoreData(null);
                  }}
                  placeholder="Candidate record ID"
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-blue-500"
                />
              </label>

              {matchData && typeof matchData.score === 'number' && (
                <div className="mb-5 flex items-center justify-between rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-200">
                  <span>Computed semantic skill match score: <strong>{Math.round(matchData.score)}/100</strong></span>
                  <button
                    type="button"
                    onClick={() => {
                      setScores((old) => ({ ...old, skillMatch: Math.round(matchData.score) }));
                      setScoreData(null);
                    }}
                    className="rounded-lg bg-blue-600 px-2.5 py-1 font-semibold text-white hover:bg-blue-500"
                  >
                    Sync Skill Match
                  </button>
                </div>
              )}

              <div className="grid gap-5 sm:grid-cols-2">
                {Object.entries(scores).map(([key, value]) => (
                  <div key={key}>
                    <div className="mb-2 flex justify-between gap-2">
                      <label className="text-sm text-slate-300">
                        {formatLabel(key)}
                      </label>
                      <span className="font-semibold text-blue-400">
                        {value}
                      </span>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={value}
                      onChange={(e) => {
                        setScores((old) => ({
                          ...old,
                          [key]: Number(e.target.value),
                        }));
                        setScoreData(null);
                      }}
                      className="w-full accent-blue-500"
                    />
                  </div>
                ))}
              </div>
              <p className="mt-4 text-sm text-amber-200">
                GitHub activity is an optional, rough public-profile signal and has zero weight in the default score. Resume-authenticity and interview-integrity heuristics are never scoring inputs.
              </p>

              <button
                onClick={calculateScore}
                disabled={loading || !candidateId.trim() || !jobId}
                className="mt-6 rounded-xl bg-blue-600 px-5 py-3 font-semibold hover:bg-blue-500 disabled:opacity-50"
              >
                Calculate AI Score
              </button>
            </Panel>

            {scoreData && (
              <>
                <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-7">
                  <p className="text-sm text-blue-200">
                    Final candidate score
                  </p>
                  <p className="mt-2 text-5xl font-bold">
                    {Number(scoreData.weightedScore).toFixed(2)}
                    <span className="text-2xl text-slate-400">/100</span>
                  </p>
                  <p className="mt-3 text-sm text-slate-300">
                    Weighted score based on the configured scoring model.
                  </p>
                </div>

                <Panel title="Score breakdown">
                  {Object.entries(scoreData.breakdown || {}).map(
                    ([key, value]) => (
                      <div key={key} className="mb-4 last:mb-0">
                        <div className="mb-2 flex justify-between text-sm">
                          <span>
                            {formatLabel(key)}{" "}
                            <span className="text-slate-500">
                              ({((scoreData.weights?.[key] || 0) * 100).toFixed(0)}% weight)
                            </span>
                          </span>
                          <span>{Number(value).toFixed(2)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-800">
                          <div
                            className="h-2 rounded-full bg-blue-500"
                            style={{
                              width: `${Math.min(
                                100,
                                Math.max(0, Number(value) || 0)
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    )
                  )}
                  <p className="mt-4 text-xs text-slate-400">Scores are decision-support only. Review job-related evidence and make the hiring decision as a human; do not use this score as an automatic verdict.</p>
                </Panel>

                <Panel title="AI explanation">
                  <p className="leading-7 text-slate-300">
                    {scoreData.explanation || "No explanation was returned."}
                  </p>
                </Panel>

                <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                  Bias audit status: not performed. This score has not been demonstrated to be fair or bias-free.
                </p>

                {scoreData.biasAuditFlags?.length > 0 && (
                  <Panel title="Audit flags">
                    {scoreData.biasAuditFlags.map((flag, index) => (
                      <p key={index} className="mb-2 text-sm text-amber-300">
                        • {flag}
                      </p>
                    ))}
                  </Panel>
                )}
              </>
            )}
          </section>
        )}

        <p className="mt-8 text-center text-xs text-slate-500">
          AI Recruit · Repository evidence and explainable candidate scoring
        </p>
      </div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
      <h2 className="mb-5 text-lg font-bold">{title}</h2>
      {children}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-3 break-words text-2xl font-bold text-blue-400">
        {value}
      </p>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1">{value || "Not available"}</p>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString();
}

function formatLabel(key) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function safeGitHubUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.href : null;
  } catch {
    return null;
  }
}
