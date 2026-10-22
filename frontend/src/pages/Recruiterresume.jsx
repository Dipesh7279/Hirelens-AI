import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axiosInstance';

const field = 'w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm';

export default function RecruiterResume() {
  const [email, setEmail] = useState('');
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    if (!file) return setError('Choose a PDF or DOCX resume.');
    const form = new FormData();
    form.append('candidateEmail', email); // text fields before the file
    form.append('file', file);
    setBusy(true);
    try {
      const { data } = await api.post('/resume/parse', form);
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Resume parsing failed.');
    } finally {
      setBusy(false);
    }
  };

  const p = result?.parsed;
  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-50">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link to="/recruiter/dashboard" className="text-sm text-indigo-300 hover:underline">← Dashboard</Link>
        <h1 className="text-3xl font-bold">Resume analysis</h1>

        <form onSubmit={submit} className="space-y-3 rounded-3xl border border-white/10 bg-slate-900/60 p-6">
          <input required type="email" className={field} placeholder="Candidate email (registered account)"
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="file" accept=".pdf,.docx" className={field}
            onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
          <button disabled={busy} className="rounded-xl bg-indigo-500 px-5 py-2 font-semibold disabled:opacity-60">
            {busy ? 'Analyzing…' : 'Parse & save to profile'}
          </button>
        </form>

        {p && (
          <div className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/60 p-6 text-sm">
            <p className="text-slate-300">
              Saved for <b>{result.candidate.name}</b> · Text-pattern heuristic: {result.authenticity.authenticityScore}/100
            </p>
            {result.parsingMode === 'heuristic_fallback' && (
              <p role="status" className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-amber-100">
                AI structuring is temporarily unavailable. Only clearly recognized skills were extracted; review and edit the saved resume fields before relying on them.
              </p>
            )}
            <p className="text-sm text-slate-400">
              Limited phrase/repetition signal only—not an AI-authorship or plagiarism detector, and not a hiring verdict or score input.
            </p>
            {result.authenticity.flags.length > 0 && (
              <ul className="list-inside list-disc text-amber-200">
                {result.authenticity.flags.map((f) => <li key={f}>{f}</li>)}
              </ul>
            )}
            <p><b>Skills:</b> {p.skills.join(', ') || '—'}</p>
            <p><b>Education:</b> {p.education.map((e) => [e.degree, e.institute, e.year].filter(Boolean).join(' · ')).join(' | ') || '—'}</p>
            <p><b>Experience:</b> {p.experience.map((e) => [e.role, e.company, e.duration].filter(Boolean).join(' · ')).join(' | ') || '—'}</p>
            <p><b>Projects:</b> {p.projects.map((x) => x.title).join(', ') || '—'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
