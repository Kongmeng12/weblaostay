import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  login as apiLogin,
  logout as apiLogout,
  registerFirstAdmin,
  me,
  tokens,
  setAuthLostHandler,
  type AdminIdentity,
} from '../lib/api';

interface AuthState {
  admin: AdminIdentity | null;
  /** True until the stored token has been checked against the server. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, name: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (...roles: AdminIdentity['role'][]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  // A stored token may be expired or revoked, so it is validated against
  // /auth/me before the app renders as logged in.
  useEffect(() => {
    let cancelled = false;

    setAuthLostHandler(() => {
      tokens.clear();
      setAdmin(null);
    });

    if (!tokens.access()) {
      setLoading(false);
      return;
    }

    me()
      .then((identity) => {
        if (!cancelled) setAdmin(identity);
      })
      .catch(() => {
        tokens.clear();
        if (!cancelled) setAdmin(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      admin,
      loading,
      async signIn(email, password) {
        const res = await apiLogin(email, password);
        tokens.set(res.accessToken, res.refreshToken);
        setAdmin(res.admin);
      },
      async signUp(email, name, password) {
        const res = await registerFirstAdmin(email, name, password);
        tokens.set(res.accessToken, res.refreshToken);
        setAdmin(res.admin);
      },
      async signOut() {
        await apiLogout();
        setAdmin(null);
      },
      can: (...roles) => (admin ? roles.includes(admin.role) : false),
    }),
    [admin, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
