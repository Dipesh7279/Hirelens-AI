import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';

export default function CandidateFeedback() {
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/candidates/${user.id}/feedback`)
      .then((r) => setItems(r.data))
      .catch(() => setError('Could not load feedback.'));
  }, [user.id]);

  const isRecruiter = user.role === 'recruiter' || user.role === 'admin';

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-50">
      <div className="mx-auto max-w-3xl space-y-4">
        <Link to={isRecruiter ? '/recruiter/dashboard' : '/dashboard'} className="text-sm text-indigo-300 hover:underline">← Dashboard</Link>
        <h1 className="text-3xl font-bold">{isRecruiter ? 'Published feedback' : 'My feedback'}</h1>
        {error && <p className="text-rose-300">{error}</p>}
        {items?.length === 0 && <p className="text-slate-400">No feedback yet.</p>}
        {items?.map((f) => (
          <div key={f._id} className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
            <div className="flex items-center justify-between">
              <p className="font-semibold">
                {isRecruiter && f.candidateId?.name ? `${f.candidateId.name} — ` : ''}{f.jobId?.title}
              </p>
              <span className="rounded-full bg-indigo-500/15 px-2.5 py-1 text-xs capitalize text-indigo-200">{f.decision}</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">{f.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
