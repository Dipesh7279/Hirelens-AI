import { useEffect, useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function resolveDestination(role, search) {
  const defaultDest = role === 'recruiter' || role === 'admin' ? '/recruiter/dashboard' : '/dashboard';
  const raw = new URLSearchParams(search).get('redirect');
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return defaultDest;

  const pathname = raw.split('?')[0].split('#')[0];
  const isRecruiterRoute = pathname === '/recruiter' || pathname.startsWith('/recruiter/');
  const isCandidateOnlyRoute =
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname === '/interviews' ||
    pathname.startsWith('/interviews/') ||
    pathname === '/jobs' ||
    pathname.startsWith('/jobs/');
  const isSharedRoute = pathname === '/feedback';

  if (role === 'candidate') {
    if (isRecruiterRoute) return defaultDest;
    return isCandidateOnlyRoute || isSharedRoute ? raw : defaultDest;
  }

  if (role === 'recruiter' || role === 'admin') {
    if (isCandidateOnlyRoute) return defaultDest;
    return isRecruiterRoute || isSharedRoute ? raw : defaultDest;
  }

  return defaultDest;
}

const HIGHLIGHTS = [
  {
    title: 'Resume & GitHub verification',
    detail: 'Structure candidate skills, experience, and public repository activity in one place.',
  },
  {
    title: 'Role-grounded AI interviews',
    detail: 'Run tailored technical, project, and behavioral interviews with session integrity insights.',
  },
  {
    title: 'Transparent hiring decisions',
    detail: 'Review weighted candidate scores, bias audits, and publish clear candidate feedback.',
  },
];

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!user) return;
    navigate(resolveDestination(user.role, location.search), { replace: true });
  }, [user, location.search, navigate]);

  const handleChange = (e) => {
    if (error) setError('');
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const email = form.email.trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!form.password) {
      setError('Password is required.');
      return;
    }

    setSubmitting(true);

    try {
      const authUser = await login(email, form.password);
      navigate(resolveDestination(authUser.role, location.search), { replace: true });
    } catch (err) {
      const message =
        err.response?.data?.error ||
        (err.code === 'ERR_NETWORK'
          ? 'Unable to reach the server. Please start the backend and try again.'
          : 'Login failed. Please try again.');
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-6 sm:py-12">
        <div className="grid w-full overflow-hidden rounded-3xl border border-white/10 bg-slate-900/80 shadow-2xl shadow-slate-950/50 backdrop-blur md:grid-cols-2">
          {/* Compact mobile brand banner so the sign-in form stays immediately accessible on narrow viewports */}
          <div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-r from-indigo-600 via-violet-600 to-sky-500 px-6 py-4 md:hidden">
            <div className="flex items-center gap-3">
              <div
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 text-base font-bold tracking-tight text-white shadow-inner"
              >
                HL
              </div>
              <div>
                <p className="text-lg font-bold leading-tight text-white">HireLens</p>
                <p className="text-xs text-indigo-100">AI-assisted technical screening & interviews</p>
              </div>
            </div>
          </div>

          {/* Left introductory panel on desktop */}
          <div className="hidden flex-col justify-between bg-gradient-to-br from-indigo-600 via-violet-600 to-sky-500 p-8 md:flex lg:p-10">
            <div>
              <div className="mb-8 flex items-center gap-3.5">
                <div
                  aria-hidden="true"
                  className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/20 text-lg font-bold tracking-tight text-white shadow-inner ring-1 ring-white/25"
                >
                  HL
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-100">
                    Talent Platform
                  </p>
                  <h1 className="text-2xl font-bold tracking-tight text-white">HireLens</h1>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-100/90">
                  Evidence-based hiring
                </p>
                <h2 className="max-w-md text-3xl font-bold leading-tight text-white lg:text-4xl">
                  Screen resumes, verify skills, and run structured interviews in one workspace.
                </h2>
                <p className="max-w-md text-sm leading-relaxed text-indigo-50/90">
                  Built for candidates and recruiting teams to move from application to structured technical evaluation with clear, auditable signals.
                </p>
              </div>
            </div>

            <ul className="mt-10 space-y-3 text-sm text-white" aria-label="HireLens platform highlights">
              {HIGHLIGHTS.map((item) => (
                <li
                  key={item.title}
                  className="flex items-start gap-3 rounded-2xl border border-white/20 bg-slate-950/20 p-3.5 backdrop-blur-sm"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20 text-xs font-bold text-white"
                  >
                    ✓
                  </span>
                  <div>
                    <p className="font-semibold text-white">{item.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-indigo-50/90">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Right sign-in form panel */}
          <div className="flex items-center justify-center p-6 sm:p-8 lg:p-10">
            <form onSubmit={handleSubmit} noValidate className="w-full max-w-md space-y-6">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
                  HireLens Account
                </p>
                <h2 className="text-2xl font-bold text-white sm:text-3xl">Sign in to HireLens</h2>
                <p className="text-sm text-slate-300">
                  Enter your candidate or recruiter credentials to continue.
                </p>
              </div>

              {error && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="flex items-start gap-3 rounded-2xl border border-rose-500/60 bg-rose-500/15 px-4 py-3 text-sm font-medium text-rose-100"
                >
                  <span aria-hidden="true" className="mt-0.5 font-bold text-rose-300">!</span>
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-5">
                <div>
                  <label
                    htmlFor="login-email"
                    className="mb-2 block text-sm font-medium text-slate-100"
                  >
                    Email address
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    aria-invalid={Boolean(error)}
                    placeholder="name@example.com"
                    value={form.email}
                    onChange={handleChange}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-slate-50 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="mb-2 block text-sm font-medium text-slate-100"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      autoComplete="current-password"
                      required
                      aria-invalid={Boolean(error)}
                      placeholder="Enter your password"
                      value={form.password}
                      onChange={handleChange}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 pr-16 text-slate-50 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      className="absolute inset-y-1.5 right-2 my-auto rounded-lg px-2.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950/50 transition hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:bg-indigo-500/60"
              >
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>

              <div className="border-t border-white/10 pt-4 text-center text-sm text-slate-300">
                <p>
                  New to HireLens?{' '}
                  <Link
                    to="/register"
                    className="rounded font-semibold text-indigo-300 underline-offset-4 transition hover:text-indigo-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    Create an account
                  </Link>
                </p>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
