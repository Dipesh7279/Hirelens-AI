import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Register from './pages/Register';
import AIAnalysis from './pages/AI_analysis';
import CandidateInterviews from './pages/CandidateInterviews';
import InterviewRoom from './pages/InterviewRoom';
import RecruiterInterviews from './pages/RecruiterInterviews';
import api from './api/axiosInstance';
import { useCallback, useEffect, useState } from 'react';
import RecruiterCandidates from './pages/RecruitCandidates';
import CandidateFeedback from './pages/Candidatefeedback';
import RecruiterResume from './pages/Recruiterresume';
import Jobs from './pages/Jobs';
import { deriveCandidatePipelineState } from './utils/candidatePipeline';

const STEP_CARD_STYLES = {
  complete: {
    card: 'border-emerald-500/40 bg-emerald-500/10',
    badge: 'bg-emerald-500/20 text-emerald-300',
  },
  ready: {
    card: 'border-amber-500/40 bg-amber-500/10',
    badge: 'bg-amber-500/20 text-amber-200',
  },
  action_required: {
    card: 'border-indigo-500/40 bg-indigo-500/10',
    badge: 'bg-indigo-500/20 text-indigo-200',
  },
  pending: {
    card: 'border-slate-800 bg-slate-900/60',
    badge: 'bg-slate-800 text-slate-300',
  },
};

const UPCOMING_BADGE_TONES = {
  emerald: 'bg-emerald-500/15 text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-200',
  indigo: 'bg-indigo-500/15 text-indigo-200',
  slate: 'bg-slate-800 text-slate-300',
};

function DashboardShell({ title, subtitle, action, navItems, children }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="flex min-h-screen">
        <aside className="hidden w-72 shrink-0 border-r border-white/10 bg-slate-900/80 p-6 lg:block">
          <div className="mb-8 flex items-center gap-3">
            <div
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500 font-bold tracking-tight text-white shadow-inner"
            >
              HL
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Talent Platform</p>
              <h2 className="text-lg font-bold tracking-tight text-white">HireLens</h2>
            </div>
          </div>
          <nav aria-label="Sidebar navigation" className="space-y-2">
            {navItems.map(({ label, active, to }) => {
              const cls = `flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${
                active
                  ? 'bg-indigo-500/15 text-indigo-100 ring-1 ring-indigo-500/40'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`;
              const inner = (
                <>
                  <span>{label}</span>
                  {active && <span className="h-2.5 w-2.5 rounded-full bg-indigo-400" />}
                </>
              );
              return to ? (
                <Link key={label} to={to} className={cls}>{inner}</Link>
              ) : (
                <button key={label} type="button" className={cls}>{inner}</button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-6 lg:px-8">
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 lg:hidden">
            <div className="flex items-center gap-2.5">
              <div
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500 text-xs font-bold tracking-tight text-white"
              >
                HL
              </div>
              <div>
                <p className="text-sm font-bold leading-tight text-white">HireLens</p>
                <p className="text-[11px] text-slate-400">Talent Platform</p>
              </div>
            </div>
            {action}
          </div>

          <nav aria-label="Mobile navigation" className="mb-5 flex flex-wrap gap-2 lg:hidden">
            {navItems.map(({ label, active, to }) => {
              const cls = `rounded-xl px-3 py-2 text-xs font-medium transition ${
                active
                  ? 'bg-indigo-500/20 text-indigo-100 ring-1 ring-indigo-500/40'
                  : 'border border-slate-800 bg-slate-900/80 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`;
              return to ? (
                <Link key={label} to={to} className={cls}>{label}</Link>
              ) : (
                <span key={label} className={cls}>{label}</span>
              );
            })}
          </nav>

          <header className="mb-8 flex flex-col gap-4 rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/30 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-300">HireLens Workspace</p>
              <h1 className="mt-1.5 truncate text-2xl font-bold text-white sm:text-3xl">{title}</h1>
              <p className="mt-1 text-sm text-slate-300">{subtitle}</p>
            </div>

            <div className="hidden shrink-0 items-center gap-3 lg:flex">
              {action}
            </div>
          </header>

          <div className="space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

function CandidateDashboard() {
  const { user, logout } = useAuth();
  const [interviews, setInterviews] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');

    const interviewsReq = api
      .get('/interviews')
      .then(({ data }) => {
        if (active) setInterviews(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (active) {
          setInterviews([]);
          setLoadError((prev) => prev || 'Could not load your latest interview status.');
        }
      });

    const profileReq = api
      .get(`/resume/${user.id}`)
      .then(({ data }) => {
        if (active) setProfile(data);
      })
      .catch((err) => {
        if (!active) return;
        if (err.response?.status === 404) {
          setProfile(null);
        } else {
          setLoadError((prev) => prev || 'Could not load your saved resume profile.');
        }
      });

    Promise.allSettled([interviewsReq, profileReq]).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [user.id]);

  const pipeline = deriveCandidatePipelineState(profile, interviews);

  return (
    <DashboardShell
      title={`Welcome, ${user.name}`}
      subtitle="Candidate dashboard"
      navItems={[
        { label: 'Overview', active: true, to: '/dashboard' },
        { label: 'Resume Parser', to: '/dashboard/resume' },
        { label: 'Interviews', to: '/interviews' },
        { label: 'Open jobs', to: '/jobs' },
        { label: 'Feedback', to: '/feedback' },
      ]}
      action={
        <button
          type="button"
          onClick={logout}
          className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-700"
        >
          Log out
        </button>
      }
    >
      {loadError && (
        <div role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {loadError}
        </div>
      )}

      {/* Screening Journey Pipeline */}
      <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">Screening Journey</p>
            <h2 className="mt-1 text-xl font-bold text-white">Application Pipeline Progress</h2>
          </div>
          <span className="rounded-full border border-indigo-500/30 bg-indigo-500/15 px-3 py-1 text-xs font-medium text-indigo-200">
            {loading ? 'Checking status…' : pipeline.overallBadge}
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {pipeline.steps.map((step, index) => {
            const style = STEP_CARD_STYLES[step.status] || STEP_CARD_STYLES.pending;
            const isLaunchButton = step.status === 'ready' && step.ctaTo.startsWith('/interviews/');
            return (
              <div key={step.title} className={`flex flex-col justify-between rounded-2xl border p-4 transition ${style.card}`}>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white">
                      {index + 1}
                    </span>
                    <span className={`truncate rounded-full px-2.5 py-0.5 text-xs font-medium ${style.badge}`}>
                      {step.badge}
                    </span>
                  </div>
                  <h3 className="mt-3 font-semibold text-white">{step.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-300">{step.description}</p>
                </div>
                <div className="mt-4">
                  {isLaunchButton ? (
                    <Link
                      to={step.ctaTo}
                      className="inline-block rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-400"
                    >
                      {step.ctaLabel}
                    </Link>
                  ) : (
                    <Link
                      to={step.ctaTo}
                      className="inline-block text-xs font-semibold text-indigo-300 hover:text-indigo-200 hover:underline"
                    >
                      {step.ctaLabel}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-slate-900/60 p-5">
          <div>
            <p className="text-sm font-medium text-slate-400">Interviews</p>
            <p className="mt-2 text-3xl font-bold text-white">{pipeline.totalInterviewsCount}</p>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {pipeline.nextInterview ? 'Includes your scheduled or active session.' : 'Total sessions assigned to your account.'}
          </p>
        </div>

        <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-slate-900/60 p-5">
          <div>
            <p className="text-sm font-medium text-slate-400">Completed Interviews</p>
            <p className="mt-2 text-3xl font-bold text-white">{pipeline.completedInterviewsCount}</p>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Sessions submitted for recruiter review.
          </p>
        </div>

        <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-slate-900/60 p-5 sm:col-span-2 lg:col-span-1">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-300">Resume Text-Pattern Check</p>
              <span className="rounded-full border border-indigo-500/30 bg-indigo-500/15 px-2.5 py-0.5 text-[11px] font-medium text-indigo-200">
                {pipeline.heuristicMetric.badge}
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {pipeline.heuristicMetric.displayValue}
            </p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            {pipeline.heuristicMetric.explanation}
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold text-white">Upcoming steps</h2>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                UPCOMING_BADGE_TONES[pipeline.upcomingStatusBadge.tone] || UPCOMING_BADGE_TONES.slate
              }`}
            >
              {pipeline.upcomingStatusBadge.label}
            </span>
          </div>

          <div className="space-y-4">
            {interviews.slice(0, 5).map((interview) => (
              <div
                key={interview._id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{interview.jobTitle}</p>
                  <p className="text-sm text-slate-400">
                    {interview.scheduledAt ? new Date(interview.scheduledAt).toLocaleString() : 'Time not set'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-indigo-500/15 px-2.5 py-1 text-xs font-medium text-indigo-200">
                    {interview.status.replace('_', ' ')}
                  </span>
                  {interview.status !== 'completed' && (
                    <Link
                      to={`/interviews/${interview._id}`}
                      className="rounded-lg bg-indigo-500 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-400"
                    >
                      Enter
                    </Link>
                  )}
                </div>
              </div>
            ))}
            {interviews.length === 0 && (
              <p className="text-sm text-slate-400">No interviews scheduled yet.</p>
            )}
          </div>
        </div>

        <div className="space-y-6 rounded-3xl border border-white/10 bg-slate-900/60 p-6">
          <div>
            <h2 className="text-xl font-semibold text-white">Profile</h2>
            <div className="mt-5 space-y-4 text-sm text-slate-300">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                <p className="text-slate-400">Email</p>
                <p className="mt-1 break-all font-medium text-white">{user.email}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                <p className="text-slate-400">Role</p>
                <p className="mt-1 font-medium capitalize text-white">{user.role}</p>
              </div>
              {pipeline.detectedGithub && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-slate-400">
                      {pipeline.githubConfirmed ? 'Confirmed GitHub' : 'Detected GitHub'}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        pipeline.githubConfirmed
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-amber-500/20 text-amber-200'
                      }`}
                    >
                      {pipeline.githubConfirmed ? 'Confirmed' : 'Unconfirmed'}
                    </span>
                  </div>
                  <a
                    href={`https://github.com/${pipeline.detectedGithub}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block font-medium text-indigo-400 hover:underline"
                  >
                    @{pipeline.detectedGithub} ↗
                  </a>
                </div>
              )}
            </div>
          </div>

          <Link
            to="/dashboard/resume"
            className="inline-flex rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400"
          >
            {pipeline.hasResume && !pipeline.isStep2Confirmed
              ? 'Review & confirm resume credentials'
              : 'Analyze or update resume'}
          </Link>
        </div>
      </div>
    </DashboardShell>
  );
}

function ResumeParserPage() {
  const { user, logout } = useAuth();
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [edited, setEdited] = useState(null);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    api.get(`/resume/${user.id}`).then(({ data }) => {
      if (data?.resume && (data.resume.fileName || data.resume.skills?.length)) {
        const parsedFields = {
          skills: data.resume.skills || [],
          education: data.resume.education || [],
          experience: data.resume.experience || [],
          projects: data.resume.projects || [],
          githubUsername: data.resume.githubUsername || data.github?.username || '',
        };
        setResult({
          profile: data,
          parsed: parsedFields,
          authenticity: {
            authenticityScore: data.resume.authenticityScore ?? 100,
            flags: data.resume.flags || [],
          },
          parsingMode: data.resume.parsingMode || 'gemini',
        });
        setEdited(parsedFields);
      }
    }).catch(() => {});
  }, [user?.id]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setResult(null);
    setEdited(null);
    setSaveMessage('');

    if (!file) {
      setError('Choose a PDF or DOCX resume to continue.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    setSubmitting(true);

    try {
      const { data } = await api.post('/resume/parse', formData);
      const parsedFields = {
        skills: data.parsed?.skills || [],
        education: data.parsed?.education || [],
        experience: data.parsed?.experience || [],
        projects: data.parsed?.projects || [],
        githubUsername: data.parsed?.githubUsername || data.profile?.resume?.githubUsername || '',
      };
      setResult(data);
      setEdited(parsedFields);
    } catch (requestError) {
      setError(
        requestError.response?.data?.error ||
          (requestError.code === 'ERR_NETWORK'
            ? 'Unable to reach the server. Please try again.'
            : 'Resume parsing failed. Please try another file.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const parsed = edited || result?.parsed;
  const isConfirmed = Boolean(result?.profile?.resume?.confirmedAt);
  const editorInput = 'w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100';

  const updateRow = (section, index, key, value) => {
    setEdited((current) => ({
      ...current,
      [section]: current[section].map((item, row) => row === index ? { ...item, [key]: value } : item),
    }));
    setSaveMessage('');
  };

  const addRow = (section, value) => {
    setEdited((current) => ({ ...current, [section]: [...current[section], value] }));
    setSaveMessage('');
  };

  const removeRow = (section, index) => {
    setEdited((current) => ({ ...current, [section]: current[section].filter((_, row) => row !== index) }));
    setSaveMessage('');
  };

  const saveCorrections = async () => {
    setSaving(true);
    setError('');
    setSaveMessage('');
    try {
      const payload = {
        skills: edited.skills,
        education: edited.education,
        experience: edited.experience,
        projects: edited.projects,
        githubUsername: edited.githubUsername ?? '',
      };
      const { data } = await api.patch(`/resume/${user.id}`, payload);
      const resume = data.profile.resume;
      setResult((current) => (current ? { ...current, profile: data.profile } : current));
      setEdited({
        skills: resume.skills || [],
        education: resume.education || [],
        experience: resume.experience || [],
        projects: resume.projects || [],
        githubUsername: resume.githubUsername || '',
      });
      setSaveMessage('Credentials confirmed and saved to your profile.');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not save resume corrections. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const downloadOriginal = async () => {
    setDownloading(true);
    setError('');
    try {
      const { data } = await api.get(`/resume/${user.id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.profile.resume.fileName || 'resume';
      link.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not download the original resume.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <DashboardShell
      title="Resume parser"
      subtitle="Upload your resume to extract skills, experience, education, and projects."
      navItems={[
        { label: 'Overview', to: '/dashboard' },
        { label: 'Resume Parser', active: true, to: '/dashboard/resume' },
        { label: 'Interviews', to: '/interviews' },
        { label: 'Open jobs', to: '/jobs' },
        { label: 'Feedback', to: '/feedback' },
      ]}
      action={
        <button
          onClick={logout}
          className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-700"
        >
          Log out
        </button>
      }
    >
      {/* Step 1 & 2 Pipeline Indicator */}
      <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">Step 1 & 2</p>
            <h2 className="mt-1 text-lg font-bold text-white">Resume Ingestion & Credentials Verification</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full px-3 py-1 font-medium ${parsed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-indigo-500/20 text-indigo-300'}`}>
              {parsed ? 'Step 1: Extracted' : 'Step 1: Upload File'}
            </span>
            <span
              className={`rounded-full px-3 py-1 font-medium ${
                isConfirmed
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : parsed
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'bg-slate-800 text-slate-400'
              }`}
            >
              {isConfirmed ? 'Step 2: Confirmed' : parsed ? 'Step 2: Review & Confirm' : 'Step 2: Pending Resume'}
            </span>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-slate-400">
              Step 3: Adaptive Interview
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-200">Resume file</span>
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setResult(null);
                setError('');
              }}
              className="block w-full rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-500 file:px-3 file:py-2 file:font-medium file:text-white hover:file:bg-indigo-400"
            />
          </label>

          <p className="text-sm text-slate-400">PDF or DOCX files only.</p>

          {error && (
            <p role="alert" className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-indigo-500 px-5 py-3 font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Analyzing resume…' : 'Parse resume'}
          </button>
        </form>
      </section>

      {parsed && (
        <section aria-live="polite" className="space-y-6">
          {result.parsingMode === 'heuristic_fallback' && (
            <p role="status" className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">
              AI structuring is temporarily unavailable. Only clearly recognized skills were extracted; review and edit the saved resume fields before relying on them.
            </p>
          )}
          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-white">Resume analysis</h2>
              <div className="flex flex-wrap items-center gap-2">
                <p className="rounded-full bg-indigo-500/15 px-3 py-1 text-sm text-indigo-200">
                  Text-pattern heuristic: {result.authenticity.authenticityScore}/100
                </p>
                <button type="button" onClick={downloadOriginal} disabled={downloading}
                  className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-60">
                  {downloading ? 'Downloading…' : 'Download original resume'}
                </button>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-400">
              This is a limited text-pattern heuristic, not an AI-authorship or plagiarism detector. It is not a hiring verdict and must not affect your hiring score.
            </p>
            {result.authenticity.flags.length > 0 && (
              <ul className="mt-4 list-inside list-disc space-y-1 text-sm text-amber-200">
                {result.authenticity.flags.map((flag) => <li key={flag}>{flag}</li>)}
              </ul>
            )}
          </div>

          <div className="rounded-3xl border border-sky-500/30 bg-sky-950/20 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-sky-300">GitHub Verification</p>
                <h3 className="mt-1 text-lg font-semibold text-white">
                  {parsed.githubUsername ? `Public GitHub Handle: @${parsed.githubUsername.replace(/^@+/, '')}` : 'Optional Public GitHub Handle'}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    result?.profile?.resume?.githubConfirmedAt
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : parsed.githubUsername
                        ? 'bg-amber-500/20 text-amber-200'
                        : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {result?.profile?.resume?.githubConfirmedAt
                    ? 'Confirmed'
                    : parsed.githubUsername
                      ? 'Detected · Needs confirmation'
                      : 'Not linked'}
                </span>
                {parsed.githubUsername && (
                  <a
                    href={`https://github.com/${parsed.githubUsername.replace(/^@+/, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/20 hover:text-white"
                  >
                    View Profile ↗
                  </a>
                )}
              </div>
            </div>
            <label className="mt-3 block text-xs text-slate-300">
              GitHub username (review or edit before confirming)
              <input
                className={`${editorInput} mt-1`}
                placeholder="e.g. octocat (leave blank if none)"
                value={parsed.githubUsername || ''}
                onChange={(event) => {
                  setEdited((current) => ({ ...current, githubUsername: event.target.value }));
                  setSaveMessage('');
                }}
              />
            </label>
            <p className="mt-2 text-xs text-slate-400">
              Only public repositories are reviewed as advisory technical evidence when confirmed.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <h3 className="mb-3 text-lg font-semibold text-white">Skills</h3>
            <label className="block text-sm text-slate-300">Comma-separated skills
              <textarea className={`${editorInput} mt-1`} rows={3} value={parsed.skills.join(', ')}
                onChange={(event) => { setEdited((current) => ({ ...current, skills: event.target.value.split(',').map((skill) => skill.trim()).filter(Boolean) })); setSaveMessage(''); }} />
            </label>
          </div>

          {[
            { section: 'education', title: 'Education', fields: [['degree', 'Degree'], ['institute', 'Institute'], ['year', 'Year']], empty: { degree: '', institute: '', year: '' } },
            { section: 'experience', title: 'Experience', fields: [['role', 'Role'], ['company', 'Company'], ['duration', 'Duration']], empty: { role: '', company: '', duration: '' } },
          ].map(({ section, title, fields, empty }) => (
            <div key={section} className="space-y-3 rounded-3xl border border-white/10 bg-slate-900/60 p-6">
              <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">{title}</h3>
                <button type="button" onClick={() => addRow(section, empty)} className="text-sm text-indigo-300 hover:underline">Add {title.toLowerCase()}</button></div>
              {parsed[section].map((item, index) => (
                <div key={`${section}-${index}`} className="grid gap-2 rounded-xl border border-slate-800 p-3 sm:grid-cols-3">
                  {fields.map(([key, label]) => <label key={key} className="text-xs text-slate-400">{label}
                    <input className={`${editorInput} mt-1`} value={item[key] || ''} onChange={(event) => updateRow(section, index, key, event.target.value)} />
                  </label>)}
                  <button type="button" onClick={() => removeRow(section, index)} className="text-left text-xs text-rose-300 hover:underline">Remove</button>
                </div>
              ))}
              {parsed[section].length === 0 && <p className="text-sm text-slate-400">No entries yet.</p>}
            </div>
          ))}

          <div className="space-y-3 rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">Projects</h3>
              <button type="button" onClick={() => addRow('projects', { title: '', description: '', techStack: [] })} className="text-sm text-indigo-300 hover:underline">Add project</button></div>
            {parsed.projects.map((project, index) => (
              <div key={`project-${index}`} className="grid gap-2 rounded-xl border border-slate-800 p-3">
                <label className="text-xs text-slate-400">Title<input className={`${editorInput} mt-1`} value={project.title || ''} onChange={(event) => updateRow('projects', index, 'title', event.target.value)} /></label>
                <label className="text-xs text-slate-400">Description<textarea className={`${editorInput} mt-1`} rows={2} value={project.description || ''} onChange={(event) => updateRow('projects', index, 'description', event.target.value)} /></label>
                <label className="text-xs text-slate-400">Technologies (comma-separated)<input className={`${editorInput} mt-1`} value={(project.techStack || []).join(', ')} onChange={(event) => updateRow('projects', index, 'techStack', event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} /></label>
                <button type="button" onClick={() => removeRow('projects', index)} className="text-left text-xs text-rose-300 hover:underline">Remove project</button>
              </div>
            ))}
            {parsed.projects.length === 0 && <p className="text-sm text-slate-400">No projects yet.</p>}
          </div>

          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
          {saveMessage && <p role="status" className="text-sm text-emerald-300">{saveMessage}</p>}
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={saveCorrections} disabled={saving}
              className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60">
              {saving ? 'Saving…' : isConfirmed ? 'Save updated credentials' : 'Save & confirm credentials'}
            </button>
            <Link to="/interviews"
              className="rounded-xl bg-indigo-500 px-5 py-3 font-semibold text-white transition hover:bg-indigo-400">
              Next: Go to Interview Room →
            </Link>
          </div>
        </section>
      )}
    </DashboardShell>
  );
}

function RecruiterDashboard() {
  const { user, logout } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [pipeline, setPipeline] = useState({ applied: [], screening: [], interviewing: [], offer: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [jobsRes, interviewsRes, pipelineRes] = await Promise.all([
        api.get('/jobs'),
        api.get('/interviews'),
        api.get('/candidates/pipeline'),
      ]);
      setJobs(Array.isArray(jobsRes.data) ? jobsRes.data : []);
      setInterviews(Array.isArray(interviewsRes.data) ? interviewsRes.data : []);
      setPipeline({
        applied: pipelineRes.data?.applied || [],
        screening: pipelineRes.data?.screening || [],
        interviewing: pipelineRes.data?.interviewing || [],
        offer: pipelineRes.data?.offer || [],
      });
    } catch (err) {
      setLoadError(err.response?.data?.error || 'Failed to load recruiter pipeline data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return (
    <DashboardShell
      title={`Welcome, ${user.name}`}
      subtitle="Recruiter dashboard"
      navItems={[
        { label: 'Overview', active: true, to: '/recruiter/dashboard' },
        { label: 'GitHub analysis & scoring', to: '/recruiter/ai-analysis' },
        { label: 'Resume analysis', to: '/recruiter/resume-analysis' },
        { label: 'Interviews', to: '/recruiter/interviews' },
        { label: 'Candidates', to: '/recruiter/candidates' },
        { label: 'Published feedback', to: '/feedback' },
      ]}
      action={
        <button
          onClick={logout}
          className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-700"
        >
          Log out
        </button>
      }
    >
      {loadError && (
        <div role="alert" className="flex items-center justify-between rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={loadDashboard}
            className="rounded-lg bg-rose-500/20 px-3 py-1 text-xs font-semibold hover:bg-rose-500/30"
          >
            Retry
          </button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ['Jobs', jobs.length],
          ['Interviews', interviews.length],
          ['In progress', interviews.filter((item) => item.status === 'in_progress').length],
          ['Completed', interviews.filter((item) => item.status === 'completed').length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
            <p className="text-sm text-slate-400">{label}</p>
            <p className="mt-2 text-3xl font-bold text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
        <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Hiring pipeline</h2>
            <span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-medium text-violet-200">
              {loading ? 'Updating…' : 'Updated now'}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            {[
              ['Applied', pipeline.applied],
              ['Screening', pipeline.screening],
              ['Interviewing', pipeline.interviewing],
              ['Offer', pipeline.offer],
            ].map(([title, items]) => (
              <div key={title} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-medium text-white">{title}</p>
                  <span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-300">
                    {items.length}
                  </span>
                </div>

                <div className="space-y-3">
                  {items.map((candidate) => (
                    <div key={candidate.id || `${candidate.candidateId}-${candidate.jobTitle}`} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                      <div className="flex items-start justify-between gap-1">
                        <p className="font-medium text-white">{candidate.name}</p>
                        {candidate.jobTitle && (
                          <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">
                            {candidate.jobTitle}
                          </span>
                        )}
                      </div>
                      {candidate.email && <p className="truncate text-[11px] text-slate-400">{candidate.email}</p>}
                      <p className="mt-1 text-xs text-indigo-300">{candidate.stage}</p>
                    </div>
                  ))}
                  {items.length === 0 && (
                    <p className="py-2 text-xs text-slate-500">{loading ? 'Loading…' : 'No candidates in this stage'}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6 rounded-3xl border border-white/10 bg-slate-900/60 p-6">
          <div>
            <h2 className="text-xl font-semibold text-white">Recent activity</h2>
            <div className="mt-5 space-y-3 text-sm text-slate-300">
              {interviews.slice(0, 5).map((item) => (
                <div key={item._id} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
                  {item.candidateId?.name || 'Candidate'} · {item.jobTitle} · {item.status.replace('_', ' ')}
                </div>
              ))}
              {interviews.length === 0 && <p className="text-sm text-slate-400">No interviews yet.</p>}
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white">Account</h2>
            <div className="mt-5 space-y-4 text-sm text-slate-300">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                <p className="text-slate-400">Email</p>
                <p className="mt-1 font-medium text-white">{user.email}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                <p className="text-slate-400">Role</p>
                <p className="mt-1 font-medium capitalize text-white">{user.role}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

function HomeRedirect() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-50">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/70 px-5 py-4 shadow-xl shadow-slate-950/30">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          <span>Loading session…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={user.role === 'recruiter' ? '/recruiter/dashboard' : '/dashboard'} replace />;
}

function Unauthorized() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-50">
      <div className="max-w-md rounded-3xl border border-rose-500/40 bg-slate-900/80 p-8 text-center shadow-xl">
        <p className="text-sm uppercase tracking-[0.2em] text-rose-300">Access denied</p>
        <h1 className="mt-4 text-3xl font-bold">You do not have access to this page.</h1>
        <a
          href="/login"
          className="mt-6 inline-flex rounded-xl bg-indigo-500 px-4 py-3 font-medium text-white transition hover:bg-indigo-400"
        >
          Go back to sign in
        </a>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/unauthorized" element={<Unauthorized />} />

          {/* Candidate protected routes */}
          <Route element={<ProtectedRoute allowedRoles={['candidate']} />}>
            <Route path="/dashboard" element={<CandidateDashboard />} />
            <Route path="/dashboard/resume" element={<ResumeParserPage />} />
            <Route path="/interviews" element={<CandidateInterviews />} />
            <Route path="/interviews/:id" element={<InterviewRoom />} />
            <Route path="/jobs" element={<Jobs />} />
          </Route>

          {/* Recruiter & Admin protected routes */}
          <Route element={<ProtectedRoute allowedRoles={['recruiter', 'admin']} />}>
            <Route path="/recruiter/dashboard" element={<RecruiterDashboard />} />
            <Route path="/recruiter/ai-analysis" element={<AIAnalysis />} />
            <Route path="/recruiter/interviews" element={<RecruiterInterviews />} />
            <Route path="/recruiter/candidates" element={<RecruiterCandidates />} />
            <Route path="/recruiter/resume-analysis" element={<RecruiterResume />} />
          </Route>

          {/* Feedback route (candidate reads own, recruiter can also view) */}
          <Route element={<ProtectedRoute allowedRoles={['candidate', 'recruiter', 'admin']} />}>
            <Route path="/feedback" element={<CandidateFeedback />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
