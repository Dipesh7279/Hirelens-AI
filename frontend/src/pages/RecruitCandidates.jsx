import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axiosInstance';

const LABELS = {
  multiple_faces: 'Multiple faces', face_absent: 'Face absent > 5s',
  phone_detected: 'Phone-like object', looking_away: 'Looking away > 6s',
  tab_switch: 'Tab / window switch',
};
const field = 'rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm';
const isSafeGithubUrl = (url) => typeof url === 'string' && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+/.test(url);

export default function RecruiterCandidates() {
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState('');
  const [newJob, setNewJob] = useState('');
  const [sort, setSort] = useState('score');
  const [minScore, setMinScore] = useState(0);
  const [rows, setRows] = useState([]);
  const [applications, setApplications] = useState([]);
  const [report, setReport] = useState(null);
  const [dossierTab, setDossierTab] = useState('overview');
  const [fb, setFb] = useState({ decision: 'rejected', notes: '' });
  const [fbText, setFbText] = useState('');
  const [liveSkillMatch, setLiveSkillMatch] = useState(null);
  const [matchingSkills, setMatchingSkills] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadJobs = () =>
    api.get('/jobs').then((r) => {
      setJobs(r.data);
      if (!jobId && r.data[0]) setJobId(r.data[0]._id);
    });
  useEffect(() => { loadJobs(); }, []); // eslint-disable-line

  useEffect(() => {
    if (!jobId) return;
    api.get(`/jobs/${jobId}/candidates`, { params: { sort, minScore } })
      .then((r) => setRows(r.data.candidates))
      .catch(() => setError('Could not load candidates.'));
  }, [jobId, sort, minScore]);

  useEffect(() => {
    if (!jobId) return;
    api.get(`/jobs/${jobId}/applications`)
      .then((r) => setApplications(r.data))
      .catch(() => setError('Could not load job applications.'));
  }, [jobId]);

  const addJob = async (e) => {
    e.preventDefault();
    if (!newJob.trim()) return;
    const { data } = await api.post('/jobs', { title: newJob });
    setNewJob('');
    await loadJobs();
    setJobId(data._id);
  };

  const openReport = async (candidateId) => {
    setFbText('');
    setError('');
    try {
      const { data } = await api.get(`/candidates/${candidateId}/report`, { params: { jobId } });
      setReport(data);
      setLiveSkillMatch(data.skillMatch || null);
      setDossierTab('overview');
      api.get(`/candidates/${candidateId}/feedback`).then((r) => {
        const mine = r.data.find((f) => f.jobId?._id === jobId);
        if (mine) setFbText(mine.text);
      }).catch(() => {});
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load candidate report.');
    }
  };

  const runSkillMatch = async () => {
    if (!report?.resume?.skills?.length || !report?.github?.skills?.length) return;
    setMatchingSkills(true);
    setError('');
    try {
      const { data } = await api.post('/ai/github/match', {
        resumeSkills: report.resume.skills,
        githubSkills: report.github.skills,
      });
      setLiveSkillMatch(data);
    } catch {
      setError('Semantic skill matching failed.');
    } finally {
      setMatchingSkills(false);
    }
  };

  const sendFeedback = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/candidates/${report.candidate._id}/feedback`, {
        jobId, decision: fb.decision, interviewNotes: fb.notes,
      });
      setFbText(data.text);
    } catch (e) {
      setError(e.response?.data?.error || 'Feedback generation failed.');
    } finally {
      setBusy(false);
    }
  };

  const updateApplicationStatus = async (applicationId, status) => {
    try {
      await api.patch(`/jobs/applications/${applicationId}/status`, { status });
      const { data } = await api.get(`/jobs/${jobId}/applications`);
      setApplications(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not update application status.');
    }
  };

  const toggleJobStatus = async () => {
    const selectedJob = jobs.find((job) => job._id === jobId);
    if (!selectedJob) return;
    try {
      const { data } = await api.patch(`/jobs/${jobId}`, { status: selectedJob.status === 'closed' ? 'open' : 'closed' });
      setJobs((current) => current.map((job) => job._id === data._id ? data : job));
    } catch (e) {
      setError(e.response?.data?.error || 'Could not update job status.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-50">
      <div className="mx-auto max-w-5xl space-y-6">
        <Link to="/recruiter/dashboard" className="text-sm text-indigo-300 hover:underline">← Dashboard</Link>
        <h1 className="text-3xl font-bold">Ranked candidates</h1>

        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4">
          <select className={field} value={jobId} onChange={(e) => { setJobId(e.target.value); setReport(null); }}>
            {jobs.length === 0 && <option value="">No jobs yet</option>}
            {jobs.map((j) => <option key={j._id} value={j._id}>{j.title}</option>)}
          </select>
          <select className={field} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="score">Sort: score</option>
            <option value="name">Sort: name</option>
          </select>
          <label className="text-sm text-slate-300">
            Min score <input type="number" min="0" max="100" className={`${field} w-20`} value={minScore}
              onChange={(e) => setMinScore(e.target.value)} />
          </label>
          {jobId && <button type="button" onClick={toggleJobStatus} className="rounded-xl border border-amber-500/40 px-3 py-2 text-sm text-amber-200">
            {jobs.find((job) => job._id === jobId)?.status === 'closed' ? 'Reopen job' : 'Close job'}
          </button>}
          <form onSubmit={addJob} className="ml-auto flex gap-2">
            <input className={field} placeholder="New job title" value={newJob} onChange={(e) => setNewJob(e.target.value)} />
            <button className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold">Add job</button>
          </form>
        </div>

        {error && <p role="alert" className="text-rose-300">{error}</p>}

        {jobId && <section className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Applications ({applications.length})</h2>
          {applications.length === 0 ? <p className="text-sm text-slate-400">No applications for this job yet.</p> : applications.map((application) => (
            <div key={application._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 p-3">
              <div><p className="font-medium">{application.candidateId?.name || 'Candidate'}</p>
                <p className="text-xs text-slate-400">{application.candidateId?.email} · applied {new Date(application.createdAt).toLocaleDateString()}</p></div>
              <select aria-label={`Application status for ${application.candidateId?.name || 'candidate'}`} className={field}
                value={application.status} onChange={(event) => updateApplicationStatus(application._id, event.target.value)}>
                {['applied', 'reviewing', 'interview', 'rejected', 'offered'].map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
          ))}
        </section>}

        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr><th className="p-3">#</th><th>Candidate</th><th>Score</th><th>Resume</th><th>GitHub</th><th>Skills</th><th>Exp.</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.candidateId} onClick={() => openReport(r.candidateId)}
                  className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/60">
                  <td className="p-3">{i + 1}</td>
                  <td>{r.name}<div className="text-xs text-slate-500">{r.email}</div></td>
                  <td className="font-semibold text-indigo-300">{r.weightedScore}</td>
                  <td>{r.breakdown?.resumeQuality}</td>
                  <td>{r.breakdown?.githubVerification}</td>
                  <td>{r.breakdown?.skillMatch}</td>
                  <td>{r.breakdown?.experienceRelevance}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="7" className="p-4 text-slate-400">No scored candidates for this job.</td></tr>}
            </tbody>
          </table>
        </div>

        {report && (
          <div className="space-y-6 rounded-3xl border border-white/10 bg-slate-900/60 p-6 text-sm shadow-2xl">
            {/* Dossier Header & Recommendation Badge */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold text-white">{report.candidate.name}</h2>
                  {report.score ? (
                    report.score.weightedScore >= 75 ? (
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300">
                        Advisory Score: High Alignment (Human Review Required)
                      </span>
                    ) : report.score.weightedScore >= 50 ? (
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/20 px-3 py-1 text-xs font-bold text-amber-300">
                        Advisory Score: Moderate Alignment (Human Review Required)
                      </span>
                    ) : (
                      <span className="rounded-full border border-rose-500/40 bg-rose-500/20 px-3 py-1 text-xs font-bold text-rose-300">
                        Advisory Score: Low Alignment (Human Review Required)
                      </span>
                    )
                  ) : (
                    <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300">
                      Evaluation In Progress
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {report.candidate.email} · Candidate Dossier
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs text-slate-400">Composite Score</p>
                  <p className="text-2xl font-bold text-indigo-300">
                    {report.score ? `${report.score.weightedScore}/100` : '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* Dossier Tabs */}
            <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
              {[
                ['overview', 'Executive Overview'],
                ['resume', 'Resume & Skills'],
                ['github', 'GitHub Evidence (Advisory)'],
                ['interview', `Interview & Integrity (${report.interviews?.length || 0})`],
                ['feedback', 'Recruiter Decision'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDossierTab(key)}
                  className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                    dossierTab === key
                      ? 'bg-indigo-500 text-white shadow-md'
                      : 'border border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Tab 1: Overview */}
            {dossierTab === 'overview' && (
              <div className="space-y-5">
                {report.score && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Scoring Breakdown</h3>
                    <div className="grid gap-3 sm:grid-cols-4">
                      {[
                        ['Skill Match', report.score.breakdown?.skillMatch ?? '—'],
                        ['Resume Quality', report.score.breakdown?.resumeQuality ?? '—'],
                        ['GitHub Verification', report.score.breakdown?.githubVerification ?? '—'],
                        ['Experience Relevance', report.score.breakdown?.experienceRelevance ?? '—'],
                      ].map(([title, val]) => (
                        <div key={title} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                          <p className="text-xs text-slate-400">{title}</p>
                          <p className="mt-1 text-xl font-bold text-white">{val}</p>
                        </div>
                      ))}
                    </div>
                    {report.score.explanation && (
                      <div className="mt-4 rounded-2xl border border-indigo-500/20 bg-indigo-950/20 p-4 text-xs text-indigo-200">
                        <p className="font-semibold text-white mb-1">Evaluation Summary:</p>
                        {report.score.explanation}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Screening Status At-A-Glance</h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                      <p className="text-xs text-slate-400">Resume Status</p>
                      <p className="mt-1 font-semibold text-white">
                        {report.resume ? `${report.resume.skills?.length || 0} skills extracted` : 'No resume uploaded'}
                      </p>
                      {report.resume?.authenticityScore !== undefined && (
                        <p className="mt-1 text-xs text-slate-400">
                          Pattern heuristic: {report.resume.authenticityScore}/100
                        </p>
                      )}
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                      <p className="text-xs text-slate-400">GitHub Binding</p>
                      <p className="mt-1 font-semibold text-white">
                        {report.github?.username ? `@${report.github.username}` : 'No GitHub bound'}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {report.github?.repositories?.length ? `${report.github.repositories.length} public repos analyzed` : 'Advisory evidence pending'}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                      <p className="text-xs text-slate-400">Interview Status</p>
                      <p className="mt-1 font-semibold text-white capitalize">
                        {report.interviews?.length ? report.interviews[0].status.replace('_', ' ') : 'Not scheduled'}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {report.interviews?.length ? `${report.interviews[0].questions?.length || 0} questions assigned` : 'Schedule from Interviews tab'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Resume & Verified Skills */}
            {dossierTab === 'resume' && (
              <div className="space-y-5">
                {report.resume ? (
                  <>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-semibold text-white">Extracted Skills ({report.resume.skills?.length || 0})</h3>
                        {report.resume.authenticityScore !== undefined && (
                          <span className="rounded-full bg-indigo-500/15 px-3 py-1 text-xs text-indigo-300">
                            Pattern Heuristic: {report.resume.authenticityScore}/100
                          </span>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {report.resume.skills?.map((skill) => (
                          <span key={skill} className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>

                    {report.resume.experience?.length > 0 && (
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
                        <h3 className="font-semibold text-white">Work Experience</h3>
                        {report.resume.experience.map((exp, idx) => (
                          <div key={idx} className="border-l-2 border-indigo-500 pl-3">
                            <p className="font-medium text-white">{exp.role} <span className="text-slate-400">at {exp.company}</span></p>
                            <p className="text-xs text-slate-400">{exp.duration}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {report.resume.education?.length > 0 && (
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 space-y-2">
                        <h3 className="font-semibold text-white">Education</h3>
                        {report.resume.education.map((edu, idx) => (
                          <div key={idx} className="text-xs text-slate-300">
                            <span className="font-medium text-white">{edu.degree}</span> · {edu.institute} ({edu.year})
                          </div>
                        ))}
                      </div>
                    )}

                    {report.resume.projects?.length > 0 && (
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
                        <h3 className="font-semibold text-white">Candidate Projects</h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {report.resume.projects.map((proj, idx) => (
                            <div key={idx} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                              <p className="font-medium text-white">{proj.title}</p>
                              {proj.description && <p className="mt-1 text-xs text-slate-400">{proj.description}</p>}
                              {proj.techStack?.length > 0 && (
                                <p className="mt-2 text-xs text-indigo-300">{proj.techStack.join(', ')}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-slate-400">No parsed resume on file for this candidate.</p>
                )}
              </div>
            )}

            {/* Tab 3: GitHub Evidence */}
            {dossierTab === 'github' && (
              <div className="space-y-4">
                {report.github ? (
                  <div className="space-y-4 rounded-2xl border border-sky-500/20 bg-sky-950/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold text-sky-200">
                        Public GitHub Repository Analysis (Advisory)
                      </h3>
                      <span className="text-xs text-slate-400">
                        @{report.github.username}
                        {report.github.analyzedAt && ` · Analyzed ${new Date(report.github.analyzedAt).toLocaleDateString()}`}
                      </span>
                    </div>

                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                      {report.github.advisoryNotice || 'Advisory analysis only. Derived from public GitHub REST API data. Does not prove authorship, skills, or identity, and is never used to automatically alter hiring decisions or candidate scores.'}
                    </div>

                    {report.github.analysisLimits && (
                      <p className="text-xs text-slate-400">
                        Scope: Public repos only · Window: {report.github.analysisLimits.commitWindowDays || 90} days · Cap: {report.github.analysisLimits.commitSampleLimit || 100} commits/repo ({report.github.analysisLimits.commitActivityScope === 'repository_recent_commits' ? 'repository-level recent commits, not individual author attribution' : 'sample'})
                      </p>
                    )}

                    {report.github.skills?.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-medium text-slate-300">Detected Languages / Technologies:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {report.github.skills.map((skill) => (
                            <span key={skill} className="rounded-md border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-xs text-slate-200">
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {report.github.repositories?.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-slate-300">
                          Public Repositories ({report.github.repositories.length}):
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {report.github.repositories.map((repo) => (
                            <div key={repo.name} className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                              <div className="flex items-center justify-between">
                                {isSafeGithubUrl(repo.repositoryUrl) ? (
                                  <a
                                    href={repo.repositoryUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-medium text-indigo-300 hover:underline"
                                  >
                                    {repo.name}
                                  </a>
                                ) : (
                                  <span className="font-medium text-slate-200">{repo.name}</span>
                                )}
                                <span className="text-xs text-slate-400">
                                  {repo.recentCommitCount ?? 0} commits
                                  {repo.recentCommitCountCapped ? '+' : ''}
                                </span>
                              </div>
                              {repo.description && (
                                <p className="mt-1 line-clamp-2 text-xs text-slate-400">{repo.description}</p>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                {repo.languages && Object.keys(repo.languages).length > 0 && (
                                  <span>{Object.keys(repo.languages).slice(0, 3).join(', ')}</span>
                                )}
                                <span>· {repo.activityWindowDays || 90}d window</span>
                                {repo.isFork ? (
                                  <span className="text-amber-300">
                                    Advisory indicator: Fork
                                    {repo.forkedFrom && isSafeGithubUrl(repo.forkedFrom) && (
                                      <a
                                        href={repo.forkedFrom}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="ml-1 underline"
                                      >
                                        (upstream)
                                      </a>
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-emerald-400">Advisory indicator: Source repository</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Resume & GitHub Skill Matching (MiniLM) */}
                    <div className="mt-4 space-y-3 rounded-2xl border border-indigo-500/30 bg-indigo-950/30 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="font-semibold text-indigo-200">
                            Resume & GitHub Skill Matching (MiniLM Semantic Alignment)
                          </h4>
                          <p className="text-xs text-slate-400">
                            Claimed resume skills are compared against GitHub-verified repository languages using all-MiniLM-L6-v2 embeddings.
                          </p>
                        </div>
                        {liveSkillMatch?.score !== undefined && (
                          <span className="rounded-full bg-indigo-500/20 border border-indigo-500/40 px-3 py-1 text-xs font-bold text-indigo-300">
                            {Number(liveSkillMatch.score).toFixed(1)}% Match Score
                          </span>
                        )}
                      </div>

                      {liveSkillMatch?.matches?.length > 0 ? (
                        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/80">
                          <table className="w-full text-left text-xs text-slate-300">
                            <thead className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                              <tr>
                                <th className="p-2.5">Claimed Resume Skill</th>
                                <th className="p-2.5">Verified GitHub Language</th>
                                <th className="p-2.5">MiniLM Text Similarity</th>
                                <th className="p-2.5">Repository Evidence</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                              {liveSkillMatch.matches.map((m, idx) => {
                                const evidenceRepos = (report.github?.repositories || []).filter(
                                  (r) => Object.hasOwn(r.languages || {}, m.githubSkill) && isSafeGithubUrl(r.repositoryUrl)
                                );
                                return (
                                  <tr key={idx} className="hover:bg-slate-800/40">
                                    <td className="p-2.5 font-medium text-slate-100">{m.resumeSkill}</td>
                                    <td className="p-2.5 text-emerald-300">{m.githubSkill}</td>
                                    <td className="p-2.5">
                                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                                        m.similarity >= 80 ? 'bg-emerald-500/20 text-emerald-300' :
                                        m.similarity >= 50 ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-400'
                                      }`}>
                                        {Number(m.similarity).toFixed(1)}%
                                      </span>
                                    </td>
                                    <td className="p-2.5">
                                      {evidenceRepos.length > 0 ? (
                                        <div className="flex flex-wrap gap-1">
                                          {evidenceRepos.map((r) => (
                                            <a
                                              key={r.name}
                                              href={r.repositoryUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="rounded bg-sky-950/60 border border-sky-500/30 px-1.5 py-0.5 text-[10px] text-sky-300 hover:underline"
                                            >
                                              {r.name} ({r.languages[m.githubSkill]}%) ↗
                                            </a>
                                          ))}
                                        </div>
                                      ) : (
                                        <span className="text-slate-500 italic">No direct language bytes</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                          <p className="text-xs text-slate-400">
                            {report.resume?.skills?.length && report.github?.skills?.length
                              ? 'MiniLM semantic skill matching is ready to run.'
                              : 'Requires both parsed resume skills and public GitHub repository languages.'}
                          </p>
                          {report.resume?.skills?.length && report.github?.skills?.length ? (
                            <button
                              onClick={runSkillMatch}
                              disabled={matchingSkills}
                              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                            >
                              {matchingSkills ? 'Calculating…' : 'Run MiniLM Skill Match'}
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-400">No GitHub profile linked to this candidate. Analyze a username in the GitHub Analysis tab to attach public evidence.</p>
                )}
              </div>
            )}

            {/* Tab 4: AI Technical Interview & Proctoring Audit */}
            {dossierTab === 'interview' && (
              <div className="space-y-4">
                {report.interviews.length === 0 ? (
                  <p className="text-slate-400">No interviews conducted yet for this candidate.</p>
                ) : (
                  report.interviews.map((iv) => (
                    <div key={iv._id} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                        <div>
                          <p className="font-bold text-white">{iv.jobTitle}</p>
                          <p className="text-xs text-slate-400 capitalize">
                            Status: <span className="text-indigo-300">{iv.status.replace('_', ' ')}</span>
                            {iv.completedAt && ` · Completed ${new Date(iv.completedAt).toLocaleString()}`}
                          </p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          iv.status === 'completed'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : iv.status === 'in_progress'
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-indigo-500/20 text-indigo-300'
                        }`}>
                          {iv.status === 'completed'
                            ? 'Completed & Sealed'
                            : iv.status === 'in_progress'
                              ? 'In Progress'
                              : 'Scheduled'}
                        </span>
                      </div>

                      {/* Q&A Breakdown */}
                      {iv.questions?.length > 0 && (
                        <div className="space-y-3">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Questions & Responses</h4>
                          {iv.questions.map((q, qIdx) => {
                            const answerObj = iv.responses?.find((r) => r.questionIndex === qIdx);
                            return (
                              <div key={qIdx} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-1.5">
                                <p className="text-xs font-medium text-indigo-400 uppercase tracking-wider">
                                  Q{qIdx + 1} · {q.type}
                                </p>
                                <p className="font-medium text-white">{q.question}</p>
                                {q.expectedFocus && (
                                  <p className="text-xs text-slate-400 italic">Expected focus: {q.expectedFocus}</p>
                                )}
                                <div className="mt-2 rounded-lg bg-slate-950/80 p-2.5 text-xs text-slate-200">
                                  <p className="text-[10px] uppercase font-semibold text-slate-400 mb-1">Candidate Answer:</p>
                                  {answerObj?.answer ? answerObj.answer : <span className="text-slate-500">No response recorded</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Proctoring & Integrity Audit */}
                      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                            Proctoring Presence Audit (Advisory)
                          </h4>
                          <span className="text-xs text-slate-400">
                            {iv.status === 'completed' ? `${iv.integrityLog?.length || 0} event(s)` : 'Available after completion'}
                          </span>
                        </div>
                        {iv.status !== 'completed' ? (
                          <p className="text-xs text-slate-500">Presence logs are withheld during the active interview and disclosed only upon completion.</p>
                        ) : iv.integrityLog?.length === 0 ? (
                          <p className="text-xs text-emerald-400">✓ No integrity anomalies flagged during session.</p>
                        ) : (
                          <ul className="space-y-1 text-xs text-slate-300 max-h-48 overflow-y-auto">
                            {iv.integrityLog.map((e, idx) => (
                              <li key={idx} className="flex items-center justify-between rounded bg-slate-950/60 px-2 py-1">
                                <span>{LABELS[e.event] || e.event}</span>
                                <span className="text-slate-500">{new Date(e.timestamp).toLocaleTimeString()}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 5: Recruiter Decision & AI Feedback */}
            {dossierTab === 'feedback' && (() => {
              const hasCompletedInterview = report.interviews?.some((iv) => iv.status === 'completed');
              return (
                <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-white">Recruiter Decision & Feedback Generation</h3>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      hasCompletedInterview ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                    }`}>
                      {hasCompletedInterview ? '✓ Completed Interview on Record' : 'Application Screening Stage'}
                    </span>
                  </div>

                  {!hasCompletedInterview && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                      Application Screening Stage: Candidate has not completed a technical interview. Feedback generated will reflect resume/portfolio screening only.
                    </div>
                  )}

                  <div className="flex gap-3">
                    <select className={field} value={fb.decision} onChange={(e) => setFb({ ...fb, decision: e.target.value })}>
                      <option value="rejected">Rejected</option>
                      <option value="selected">Selected</option>
                    </select>
                  </div>
                  <textarea
                    rows={3}
                    className={`${field} w-full`}
                    placeholder={hasCompletedInterview ? "Interview notes (technical strengths, communication, architecture)" : "Screening evaluation notes (resume credentials, project alignment)"}
                    value={fb.notes}
                    onChange={(e) => setFb({ ...fb, notes: e.target.value })}
                  />
                  <button onClick={sendFeedback} disabled={busy}
                    className="rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-white disabled:opacity-60 hover:bg-emerald-400">
                    {busy ? 'Generating…' : fbText ? 'Regenerate & publish' : 'Generate & publish'}
                  </button>
                  {fbText && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-slate-200">
                      <p className="font-bold text-emerald-300 mb-1">Published Feedback:</p>
                      {fbText}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
