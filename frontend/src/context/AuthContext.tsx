import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type { AuthUser } from '../api/client';

// ── Context shape ─────────────────────────────────────────────

interface AuthCtx {
  user: AuthUser | null;
  token: string | null;
  isLoggedIn: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, cap?: number) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  user: null, token: null, isLoggedIn: false, loading: true,
  login: async () => {}, register: async () => {}, logout: () => {}, refreshUser: async () => {},
});

export const useAuth = () => useContext(AuthContext);

// ── Provider ──────────────────────────────────────────────────

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem('asklycart_token')
  );
  const [loading, setLoading] = useState(true);

  // On mount: if token exists, validate it against /api/auth/me
  useEffect(() => {
    if (!token) { setLoading(false); return; }
    api.getMe()
      .then(u => setUser(u))
      .catch(err => {
        // Only log out if the token is genuinely invalid/expired (HTTP 401/403).
        // Network errors (TypeError: Failed to fetch, ERR_EMPTY_RESPONSE etc.)
        // happen when the backend restarts — keep the token so the user stays
        // logged in and everything works once the backend is back up.
        const isNetworkError = err instanceof TypeError;
        if (!isNetworkError) {
          localStorage.removeItem('asklycart_token');
          setToken(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const _persist = (t: string, u: AuthUser) => {
    localStorage.setItem('asklycart_token', t);
    setToken(t);
    setUser(u);
  };

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password);
    _persist(res.token, res.user);
  };

  const register = async (name: string, email: string, password: string, cap?: number) => {
    const res = await api.register(name, email, password, cap);
    _persist(res.token, res.user);
  };

  const logout = () => {
    localStorage.removeItem('asklycart_token');
    setToken(null);
    setUser(null);
  };

  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const u = await api.getMe();
      setUser(u);
    } catch { /* token expired — leave user as-is */ }
  }, [token]);

  return (
    <AuthContext.Provider value={{
      user, token, isLoggedIn: !!user, loading,
      login, register, logout, refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
