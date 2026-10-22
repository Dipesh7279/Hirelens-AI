import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { setAccessToken } from '../api/axiosInstance';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const setAuthUser = useCallback((nextUser) => {
    setUser(nextUser);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const { data } = await api.post('/auth/refresh');
      setAccessToken(data.accessToken);
      const meRes = await api.get('/auth/me');
      setAuthUser(meRes.data.user);
      return meRes.data.user;
    } catch (error) {
      setAccessToken(null);
      setAuthUser(null);
      throw error;
    }
  }, [setAuthUser]);

  useEffect(() => {
    (async () => {
      try {
        await refreshSession();
      } catch {
        setAuthUser(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [refreshSession, setAuthUser]);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setAuthUser(data.user);
    return data.user;
  }, [setAuthUser]);

  const register = useCallback(async (name, email, password, role) => {
    const { data } = await api.post('/auth/register', { name, email, password, role });
    setAccessToken(data.accessToken);
    setAuthUser(data.user);
    return data.user;
  }, [setAuthUser]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setAccessToken(null);
      setAuthUser(null);
    }
  }, [setAuthUser]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: Boolean(user),
        login,
        register,
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
