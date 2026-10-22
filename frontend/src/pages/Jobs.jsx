import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';

export default function Jobs() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [hasResume, setHasResume] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyJob, setBusyJob] = useState('');
  const [withdrawingId, setWithdrawingId] = useState('');
  const [appealFormId, setAppealFormId] = useState('');
  const [appealJustification, setAppealJustification] = useState('');
  const [submittingAppeal, setSubmittingAppeal] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [jobsResponse, applicationsResponse] = await Promise.all([
        api.get('/jobs'),
        api.get('/jobs/applications/mine'),
      ]);
      setJobs(jobsResponse.data);
      setApplications(applicationsResponse.data);

      if (user?.id) {
        try {
          const profileRes = await api.get(`/resume/${user.id}`);
          setHasResume(Boolean(profileRes.data?.resume?.parsedAt));
        } catch (profileErr) {
          if (profileErr.response?.status === 404) {
            setHasResume(false);
          }
        }
      }
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not load jobs. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const apply = async (jobId) => {
    if (hasResume === false) {
      setError('Please upload your resume before applying to jobs so your skills can be verified.');
      return;
    }
    setBusyJob(jobId);
    setError('');
    setSuccessMessage('');
    try {
      await api.post(`/jobs/${jobId}/applications`);
      await load();
      setSuccessMessage('Application submitted successfully!');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not submit application.');
    } finally {
      setBusyJob('');
    }
  };

  const withdraw = async (applicationId) => {
    if (!window.confirm('Are you sure you want to withdraw this application?')) return;
    setWithdrawingId(applicationId);
    setError('');
    setSuccessMessage('');
    try {
      await api.delete(`/jobs/applications/${applicationId}`);
      await load();
      setSuccessMessage('Application withdrawn.');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not withdraw application.');
    } finally {
      setWithdrawingId('');
    }
  };

  const submitAppeal = async (applicationId) => {
    if (!appealJustification.trim() || appealJustification.trim().length < 10) {
      setError('Appeal justification must be at least 10 characters.');
      return;
    }
    setSubmittingAppeal(true);
    setError('');
    setSuccessMessage('');
    try {
      await api.post(`/jobs/applications/${applicationId}/appeal`, {
        justification: appealJustification.trim(),
      });
      setAppealFormId('');
      setAppealJustification('');
      await load();
      setSuccessMessage('Appeal submitted for review.');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not submit appeal.');
    } finally {
      setSubmittingAppeal(false);
    }
  };

  const appByJob = new Map(applications.map((application) => [application.jobId?._id, application]));

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-50">
      <div className="mx-auto max-w-4xl space-y-6">
        <Link to="/dashboard" className="text-sm text-indigo-300 hover:underline">← Dashboard</Link>
        <div>
          <h1 className="text-3xl font-bold">Open jobs</h1>
          <p className="mt-2 text-slate-400">Browse current openings and track your applications.</p>
        </div>

        {hasResume === false && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            <span>You haven't uploaded a resume yet. A parsed resume is required before applying to jobs.</span>
            <Link to="/dashboard/resume" className="rounded-lg bg-amber-500/20 px-3 py-1.5 font-semibold text-amber-100 hover:bg-amber-500/30">
              Upload Resume →
            </Link>
          </div>
        )}

        {error && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</p>}
        {successMessage && <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{successMessage}</p>}

        {loading ? <p className="text-slate-400">Loading…</p> : jobs.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 text-slate-300">No open jobs are available right now.</p>
        ) : jobs.map((job) => {
          const app = appByJob.get(job._id);
          return (
            <article key={job._id} className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <h2 className="text-xl font-semibold">{job.title}</h2>
              {job.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{job.description}</p>}
              {!!job.requiredSkills?.length && <p className="mt-3 text-xs text-slate-400">Skills: {job.requiredSkills.join(', ')}</p>}
              <div className="mt-4">
                {app ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                        app.status === 'offered' ? 'bg-emerald-500/15 text-emerald-200' :
                        app.status === 'interview' ? 'bg-indigo-500/15 text-indigo-200' :
                        app.status === 'rejected' ? 'bg-rose-500/15 text-rose-200' :
                        'bg-slate-700 text-slate-200'
                      }`}>
                        Application: {app.status}
                      </span>
                      {['applied', 'reviewing'].includes(app.status) && (
                        <button
                          type="button"
                          disabled={withdrawingId === app._id}
                          onClick={() => withdraw(app._id)}
                          className="text-xs text-rose-400 hover:text-rose-300 hover:underline disabled:opacity-50"
                        >
                          {withdrawingId === app._id ? 'Withdrawing…' : 'Withdraw Application'}
                        </button>
                      )}
                      {app.status === 'interview' && (
                        <Link to="/interviews" className="text-xs text-indigo-300 hover:underline">
                          Go to Interviews →
                        </Link>
                      )}
                    </div>

                    {app.status === 'rejected' && (
                      <div className="rounded-xl border border-white/5 bg-slate-950/40 p-3 text-xs">
                        {app.appeal?.status === 'pending' ? (
                          <p className="font-medium text-amber-300">Appeal submitted (Pending recruiter review)</p>
                        ) : app.appeal?.status === 'accepted' ? (
                          <p className="font-medium text-emerald-300">Appeal accepted</p>
                        ) : app.appeal?.status === 'rejected' ? (
                          <p className="font-medium text-rose-400">Appeal rejected</p>
                        ) : appealFormId === app._id ? (
                          <div className="space-y-2">
                            <label className="block text-slate-300">
                              Appeal Justification (minimum 10 characters):
                              <textarea
                                value={appealJustification}
                                onChange={(e) => setAppealJustification(e.target.value)}
                                placeholder="Explain why your qualifications merit reconsideration for this role..."
                                rows={3}
                                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-white outline-none focus:border-indigo-500"
                              />
                            </label>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={submittingAppeal}
                                onClick={() => submitAppeal(app._id)}
                                className="rounded bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                              >
                                {submittingAppeal ? 'Submitting…' : 'Submit Appeal'}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setAppealFormId(''); setAppealJustification(''); }}
                                className="rounded border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setAppealFormId(app._id); setAppealJustification(''); }}
                            className="text-xs text-indigo-400 hover:text-indigo-300 hover:underline"
                          >
                            Request Adverse Decision Appeal
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busyJob === job._id || hasResume === false}
                    onClick={() => apply(job._id)}
                    className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
                  >
                    {busyJob === job._id ? 'Applying…' : 'Apply'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
