import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'candidate',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!user) return;
    navigate(user.role === 'recruiter' ? '/recruiter/dashboard' : '/dashboard', { replace: true });
  }, [user, navigate]);

  const handleChange = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const trimmedName = form.name.trim();
    const trimmedEmail = form.email.trim();

    if (!trimmedName || trimmedName.length < 2) {
      setError('Please enter your full name.');
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (form.password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);

    try {
      const authUser = await register(trimmedName, trimmedEmail, form.password, form.role);
      navigate(authUser.role === 'recruiter' ? '/recruiter/dashboard' : '/dashboard');
    } catch (err) {
      const message =
        err.response?.data?.error ||
        (err.code === 'ERR_NETWORK'
          ? 'Unable to reach the server. Please start the backend and try again.'
          : 'Registration failed. Please try again.');
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-12">
        <div className="grid w-full overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70 shadow-2xl shadow-slate-950/40 backdrop-blur md:grid-cols-2">
          <div className="flex flex-col justify-between bg-gradient-to-br from-sky-600 via-cyan-600 to-indigo-700 p-8 md:p-10">
            <div>
              <div className="mb-8 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 text-lg font-semibold">
                  AR
                </div>
                <div>
                  <p className="text-sm uppercase tracking-[0.22em] text-sky-100">Join us</p>
                  <h1 className="text-xl font-semibold">AI Recruitment</h1>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-sky-100/80">
                  Create profile
                </p>
                <h2 className="max-w-sm text-3xl font-bold leading-tight md:text-4xl">
                  Start building your hiring pipeline today.
                </h2>
              </div>
            </div>

            <div className="mt-10 space-y-3 text-sm text-sky-50/90">
              <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/5 p-3">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-base">✓</span>
                Manage candidate applications faster
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/5 p-3">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-base">✓</span>
                Build your recruiter or candidate profile
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/5 p-3">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-base">✓</span>
                Stay organized across every stage
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center p-6 md:p-10">
            <form onSubmit={handleSubmit} className="w-full max-w-md space-y-6">
              <div className="space-y-2">
                <p className="text-sm uppercase tracking-[0.2em] text-indigo-300">Register</p>
                <h3 className="text-3xl font-bold text-white">Create account</h3>
              </div>

              {error && (
                <div className="rounded-2xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-200">Full name</span>
                  <input
                    name="name"
                    required
                    placeholder="John Doe"
                    value={form.name}
                    onChange={handleChange}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-50 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-200">Email</span>
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="name@example.com"
                    value={form.email}
                    onChange={handleChange}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-50 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-200">Password</span>
                  <div className="relative">
                    <input
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      placeholder="Min 8 characters"
                      value={form.password}
                      onChange={handleChange}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 pr-12 text-slate-50 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute inset-y-0 right-3 my-auto rounded-lg px-2 text-sm text-slate-300 transition hover:text-white"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-200">Confirm password</span>
                  <div className="relative">
                    <input
                      name="confirmPassword"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      placeholder="Repeat your password"
                      value={form.confirmPassword}
                      onChange={handleChange}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 pr-12 text-slate-50 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-200">Role</span>
                  <select
                    name="role"
                    value={form.role}
                    onChange={handleChange}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-50 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  >
                    <option value="candidate">Candidate</option>
                    <option value="recruiter">Recruiter</option>
                  </select>
                </label>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-indigo-500 px-4 py-3 font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-indigo-400/70"
              >
                {submitting ? 'Creating account…' : 'Create account'}
              </button>

              <div className="pt-2 text-center text-sm text-slate-300">
                Already have an account?{' '}
                <Link to="/login" className="font-medium text-indigo-300 hover:text-indigo-200">
                  Sign in
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
