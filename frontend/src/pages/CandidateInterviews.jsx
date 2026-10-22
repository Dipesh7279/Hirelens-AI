import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axiosInstance';

export default function CandidateInterviews() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/interviews').then((r) => setItems(r.data)).catch(() => setError('Could not load interviews.'));
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-50">
      <div className="mx-auto max-w-3xl space-y-4">
        <Link to="/dashboard" className="text-sm text-indigo-300 hover:underline">← Dashboard</Link>
        <h1 className="text-3xl font-bold">My interviews</h1>
        {error && <p className="text-rose-300">{error}</p>}
        {items?.length === 0 && <p className="text-slate-400">No interviews scheduled yet.</p>}
        {items?.map((iv) => (
          <div key={iv._id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/60 p-5">
            <div>
              <p className="font-semibold">{iv.jobTitle}</p>
              <p className="text-sm text-slate-400 capitalize">{iv.status.replace('_', ' ')}</p>
            </div>
            {iv.status !== 'completed' && (
              <Link to={`/interviews/${iv._id}`} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold hover:bg-indigo-400">
                {iv.status === 'in_progress' ? 'Resume' : 'Start'}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
