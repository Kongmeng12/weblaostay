import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  login as apiLogin,
  logout as apiLogout,
  me,
  tokens,
  setAuthLostHandler,
  type AdminRole,
  type Identity,
} from '../lib/api';

interface AuthState {
  admin: Identity | null;
  /** True until the stored token has been checked against the server. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** True when the signed-in admin holds one of the given roles. */
  can: (...roles: AdminRole[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Identity | null>(null);
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
        if (cancelled) return;
        // A token belonging to a customer or partner is not an error, but it is
        // not a session here either.
        if (identity.role !== 'ADMIN') {
          tokens.clear();
          setAdmin(null);
          return;
        }
        setAdmin(identity);
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
        setAdmin(res.user);
      },
      async signOut() {
        await apiLogout();
        setAdmin(null);
      },
      can: (...roles) => (admin?.adminRole ? roles.includes(admin.adminRole) : false),
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
