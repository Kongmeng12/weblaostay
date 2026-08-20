import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { c, radius, shadow, type as t, TAP } from '../theme';
import { Button, ErrorNote, Field, Page, Spinner, inputStyle } from '../components/ui';

export function SignInPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/trips';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="ເຂົ້າສູ່ລະບົບ"
      subtitle="ໃສ່ອີເມວ ແລະ ລະຫັດຜ່ານຂອງທ່ານ"
      footer={
        <>
          ຍັງບໍ່ມີບັນຊີ?{' '}
          <Link
            to="/signup"
            state={location.state}
            style={{ display: 'inline-flex', alignItems: 'center', minHeight: TAP, font: t.label }}
          >
            ສະໝັກສະມາຊິກ
          </Link>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
        <Field label="ອີເມວ">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            placeholder="you@example.com"
            style={inputStyle}
          />
        </Field>

        <Field label="ລະຫັດຜ່ານ">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="••••••••"
            style={inputStyle}
          />
        </Field>

        {error != null && <ErrorNote error={error} />}

        <Button type="submit" size="lg" full disabled={busy}>
          {busy ? <Spinner size={17} color="#fff" /> : 'ເຂົ້າສູ່ລະບົບ'}
        </Button>

        <Link
          to="/forgot"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: TAP,
            font: t.caption,
            color: c.muted,
          }}
        >
          ລືມລະຫັດຜ່ານ?
        </Link>
      </form>
    </AuthShell>
  );
}

/** The frame shared by sign-in, sign-up and password reset. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Page width="wide">
      <div
        style={{
          maxWidth: 420,
          margin: '0 auto',
          background: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: radius.lg,
          boxShadow: shadow.card,
          padding: 28,
        }}
      >
        <h1 style={{ font: t.h1, color: c.text, margin: '0 0 6px' }}>{title}</h1>
        <p style={{ font: t.bodySm, color: c.muted, margin: '0 0 24px' }}>{subtitle}</p>
        {children}
        {footer && (
          <div
            style={{
              marginTop: 22,
              paddingTop: 18,
              borderTop: `1px solid ${c.divider}`,
              font: t.bodySm,
              color: c.muted,
              textAlign: 'center',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </Page>
  );
}
