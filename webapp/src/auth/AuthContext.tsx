import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  me,
  tokens,
  setAuthLostHandler,
  type Identity,
  type RegisterInput,
} from '../lib/api';

interface AuthState {
  user: Identity | null;
  /** True until any stored token has been checked against the server. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Browsing is public — search and property pages need no account at all — so a
 * signed-out visitor is the normal state here, not an error. Only the booking
 * step and the account pages require signing in.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    setAuthLostHandler(() => {
      tokens.clear();
      setUser(null);
    });

    if (!tokens.has) {
      setLoading(false);
      return;
    }

    // A stored token may be expired or revoked, so it is checked before the app
    // renders as signed in.
    me()
      .then((identity) => {
        if (cancelled) return;
        if (identity.role !== 'CUSTOMER') {
          tokens.clear();
          setUser(null);
          return;
        }
        setUser(identity);
      })
      .catch(() => {
        tokens.clear();
        if (!cancelled) setUser(null);
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
      user,
      loading,
      async signIn(email, password) {
        const res = await apiLogin(email.trim(), password);
        tokens.set(res.accessToken, res.refreshToken);
        setUser(res.user);
      },
      async signUp(input) {
        const res = await apiRegister({
          ...input,
          email: input.email.trim(),
          fullName: input.fullName.trim(),
          phone: input.phone.trim(),
        });
        tokens.set(res.accessToken, res.refreshToken);
        setUser(res.user);
      },
      async signOut() {
        await apiLogout();
        setUser(null);
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
