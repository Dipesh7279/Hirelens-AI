import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axiosInstance';

const LABELS = {
  multiple_faces: 'Multiple faces in frame',
  face_absent: 'Face absent > 5s',
  phone_detected: 'Phone-like object',
  looking_away: 'Looking away > 6s',
  tab_switch: 'Tab / window switch',
};

const LEVEL_STYLES = {
  none: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30',
  low: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  review: 'bg-rose-500/15 text-rose-200 border-rose-500/30',
};
const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const field = 'w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm';
const toLocalDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default function RecruiterInterviews() {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({ candidateEmail: '', jobTitle: '', jobDescription: '', skills: '', projects: '', scheduledAt: '' });
  const [scheduleEdits, setScheduleEdits] = useState({});
  const [rescheduleMessages, setRescheduleMessages] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.get('/interviews').then((r) => setList(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const prefill = async () => {
    if (!form.candidateEmail.trim()) return;
    try {
      const { data: candidate } = await api.get('/interviews/lookup/candidate', { params: { email: form.candidateEmail } });
      setError('');
      try {
        const { data: profile } = await api.get(`/resume/${candidate.id}`);
        setForm((current) => ({
          ...current,
          skills: [...new Set([...(profile.resume?.skills || []), ...(profile.github?.skills || [])])].join(', '),
          projects: (profile.resume?.projects || []).map((project) => project.title).filter(Boolean).join(', '),
        }));
      } catch {
        // Candidate has no stored profile or hasn't applied to this recruiter's job yet; allow manual entry
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Could not find a candidate account with that email.');
    }
  };

  const create = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/interviews', {
        candidateEmail: form.candidateEmail,
        jobTitle: form.jobTitle,
        jobDescription: form.jobDescription,
        verifiedSkills: split(form.skills),
        projectTitles: split(form.projects),
        ...(form.scheduledAt ? { scheduledAt: new Date(form.scheduledAt).toISOString() } : {}),
      });
      setForm({ candidateEmail: '', jobTitle: '', jobDescription: '', skills: '', projects: '', scheduledAt: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create interview.');
    } finally {
      setBusy(false);
    }
  };

  const reschedule = async (interviewId) => {
    const value = scheduleEdits[interviewId];
    if (!value) {
      setRescheduleMessages((prev) => ({ ...prev, [interviewId]: { type: 'error', text: 'Choose a new interview time.' } }));
      return;
    }
    setBusy(true);
    setRescheduleMessages((prev) => ({ ...prev, [interviewId]: null }));
    try {
      await api.patch(`/interviews/${interviewId}/schedule`, { scheduledAt: new Date(value).toISOString() });
      setRescheduleMessages((prev) => ({ ...prev, [interviewId]: { type: 'success', text: 'Interview rescheduled successfully.' } }));
      await load();
    } catch (err) {
      setRescheduleMessages((prev) => ({ ...prev, [interviewId]: { type: 'error', text: err.response?.data?.error || 'Could not reschedule interview.' } }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-50">
      <div className="mx-auto max-w-4xl space-y-6">
        <Link to="/recruiter/dashboard" className="text-sm text-indigo-300 hover:underline">← Dashboard</Link>
        <h1 className="text-3xl font-bold">Interviews</h1>

        <form onSubmit={create} className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/60 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
            <div>
              <h2 className="text-lg font-semibold text-white">New interview (Grounded AI Question Generation)</h2>
              <p className="text-xs text-slate-400">Questions are strictly grounded in candidate verified skills and projects. EEOC and demographic inquiries are blocked.</p>
            </div>
            <span className="text-xs text-slate-400"><span className="text-rose-400">*</span> indicates required field</span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">
                Candidate email <span className="text-rose-400">*</span>
              </label>
              <input required type="email" className={field} placeholder="candidate@example.com" value={form.candidateEmail}
                onChange={(e) => setForm({ ...form, candidateEmail: e.target.value })} onBlur={prefill} />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">
                Job title <span className="text-rose-400">*</span>
              </label>
              <input required className={field} placeholder="e.g. Senior Backend Engineer" value={form.jobTitle}
                onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">
                Verified skills <span className="text-rose-400">*</span>
                <span className="ml-1 text-[11px] font-normal text-slate-400">(comma-separated)</span>
              </label>
              <input required className={field} placeholder="e.g. Node.js, Python, PostgreSQL" value={form.skills}
                onChange={(e) => setForm({ ...form, skills: e.target.value })} />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">
                Candidate projects or repositories
                <span className="ml-1 text-[11px] font-normal text-slate-500">(optional)</span>
              </label>
              <input className={field} placeholder="e.g. my-ecommerce-api, search-service" value={form.projects}
                onChange={(e) => setForm({ ...form, projects: e.target.value })} />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-400">
                Interview schedule timestamp
                <span className="ml-1 text-[11px] font-normal text-slate-500">(optional — leave empty for unscheduled on-demand)</span>
              </label>
              <input type="datetime-local" className={field} value={form.scheduledAt}
                onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">
              Job description
              <span className="ml-1 text-[11px] font-normal text-slate-500">(optional — stored for recruiter reference; excluded from AI prompts for fairness)</span>
            </label>
            <textarea className={field} rows={3} placeholder="Describe the role responsibilities and scope..." value={form.jobDescription}
              onChange={(e) => setForm({ ...form, jobDescription: e.target.value })} />
          </div>

          {error && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}

          <button disabled={busy} className="rounded-xl bg-indigo-500 px-5 py-2.5 font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-60">
            {busy ? 'Generating questions & validating…' : 'Generate & schedule interview'}
          </button>
        </form>

        {list.map((iv) => (
          <div key={iv._id} className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
            <button className="flex w-full items-center justify-between text-left"
              onClick={() => setOpen(open === iv._id ? null : iv._id)}>
              <div>
                <p className="font-semibold text-white">{iv.jobTitle} — {iv.candidateId?.name || 'Candidate'}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
                  <span>{iv.candidateId?.email}</span>
                  <span>·</span>
                  <span className="capitalize">{iv.status.replace('_', ' ')}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${iv.questionSource === 'fallback'
                    ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30'
                    : 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/30'}`}>
                    {iv.questionSource === 'fallback' ? 'Template fallback' : 'AI-generated'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{iv.scheduledAt ? new Date(iv.scheduledAt).toLocaleString() : 'Time not scheduled'}</p>
              </div>
              <span className="text-slate-400">{open === iv._id ? '−' : '+'}</span>
            </button>

            {open === iv._id && (
              <div className="mt-4 space-y-5 border-t border-white/5 pt-4 text-sm">
                {iv.questionSource === 'fallback' && (
                  <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    AI question generation was temporarily unavailable or failed validation when this interview was created. Grounded template fallback questions are shown below.
                  </p>
                )}
                {iv.status === 'scheduled' && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-2">
                    <p className="text-xs font-medium text-slate-300">Reschedule interview (Allowed only while scheduled)</p>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="min-w-64 flex-1 text-xs text-slate-400">
                        New future interview time
                        <input type="datetime-local" className={`${field} mt-1`}
                          value={scheduleEdits[iv._id] ?? toLocalDateTime(iv.scheduledAt)}
                          onChange={(event) => setScheduleEdits({ ...scheduleEdits, [iv._id]: event.target.value })} />
                      </label>
                      <button type="button" disabled={busy} onClick={() => reschedule(iv._id)}
                        className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
                        Save new time
                      </button>
                    </div>
                    {rescheduleMessages[iv._id]?.type === 'error' && (
                      <p role="alert" className="text-xs text-rose-300">{rescheduleMessages[iv._id].text}</p>
                    )}
                    {rescheduleMessages[iv._id]?.type === 'success' && (
                      <p role="status" className="text-xs text-emerald-300">{rescheduleMessages[iv._id].text}</p>
                    )}
                  </div>
                )}
                <div>
                  <h3 className="mb-2 font-semibold text-white">Questions (3 technical · 2 project · 1 behavioral)</h3>
                  <ol className="list-decimal space-y-2 pl-5 text-slate-300">
                    {iv.questions.map((q, i) => (
                      <li key={i}>
                        <span className="mr-2 rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs text-indigo-200">{q.type}</span>
                        {q.question}
                        <p className="text-xs text-slate-500">Evaluation focus (recruiter-only): {q.expectedFocus}</p>
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <h3 className="mb-2 font-semibold text-white">Candidate responses</h3>
                  {iv.responses?.length ? (
                    <ol className="list-decimal space-y-3 pl-5 text-slate-300">
                      {iv.responses.map((response) => (
                        <li key={response.questionIndex}>
                          <p className="font-medium text-slate-200">{iv.questions[response.questionIndex]?.question}</p>
                          <p className="mt-1 whitespace-pre-wrap">{response.answer || 'No answer submitted.'}</p>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="text-slate-400">No answers submitted yet.</p>}
                </div>
                <div>
                  <h3 className="mb-1 font-semibold text-white">Presence & attention log</h3>
                  {iv.status !== 'completed' ? (
                    <p className="mb-2 text-xs text-slate-500">Available after the interview is completed.</p>
                  ) : <>
                  {iv.integritySummary && (
                    <div className="mb-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-300">
                          {iv.integritySummary.advisoryNote || 'Advisory - not part of the score'}
                        </span>
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase ${LEVEL_STYLES[iv.integritySummary.level] || LEVEL_STYLES.none}`}>
                          Level: {iv.integritySummary.level}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        Frames analyzed: {iv.integritySummary.framesAnalyzed ?? 0}
                        {iv.integritySummary.durationMinutes ? ` · Duration: ${iv.integritySummary.durationMinutes} min` : ''}
                      </p>
                      <div className="grid grid-cols-2 gap-1.5 text-xs text-slate-300 sm:grid-cols-5">
                        {Object.entries(LABELS).map(([key, label]) => (
                          <div key={key} className="rounded-lg border border-slate-800/80 bg-slate-900/70 px-2 py-1">
                            <p className="text-slate-400 truncate" title={label}>{label}</p>
                            <p className="font-semibold text-white">{iv.integritySummary.counts?.[key] ?? 0}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="mb-2 text-xs text-slate-500">
                    Advisory only. Not included in the candidate score. Review in context before drawing conclusions.
                  </p>
                  {iv.integrityLog.length === 0 ? (
                    <p className="text-slate-400">No events recorded.</p>
                  ) : (
                    <ul className="space-y-1 text-slate-300">
                      {iv.integrityLog.map((e, i) => (
                        <li key={i}>
                          {new Date(e.timestamp).toLocaleTimeString()} — {LABELS[e.event] || e.event}
                          <span className="text-slate-500"> ({Math.round(e.confidence * 100)}%)</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  </>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
