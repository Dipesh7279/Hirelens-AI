import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Wrap protected routes with this component.
 * Usage in router:
 *   <Route element={<ProtectedRoute allowedRoles={['recruiter','admin']} />}>
 *     <Route path="/dashboard" element={<Dashboard />} />
 *   </Route>
 */
export default function ProtectedRoute({ allowedRoles }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

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
    const redirectTarget = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirectTarget}`} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
