import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { c, f, type as t, TAP } from '../theme';
import { Button, ErrorNote, Field, inputStyle, Spinner } from '../components/ui';
import { AuthShell } from './SignIn';

export function SignUpPage() {
  const { user, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/trips';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signUp({ fullName, email, phone, password, acceptedTerms });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="ສະໝັກສະມາຊິກ"
      subtitle="ສ້າງບັນຊີເພື່ອຈອງທີ່ພັກ ແລະ ຕິດຕາມການເດີນທາງຂອງທ່ານ"
      footer={
        <>
          ມີບັນຊີແລ້ວ?{' '}
          <Link
            to="/signin"
            state={location.state}
            style={{ display: 'inline-flex', alignItems: 'center', minHeight: TAP, font: t.label }}
          >
            ເຂົ້າສູ່ລະບົບ
          </Link>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
        <Field label="ຊື່ ແລະ ນາມສະກຸນ">
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            minLength={2}
            autoComplete="name"
            placeholder="ນາງ ສຸດາ ວົງສາ"
            style={inputStyle}
          />
        </Field>

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

        {/* The property phones the guest about their arrival, so this is not
            optional — the API requires it too. */}
        <Field label="ເບີໂທ" hint="ທີ່ພັກຈະຕິດຕໍ່ທ່ານທາງເບີນີ້">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            minLength={6}
            autoComplete="tel"
            placeholder="+856 20 5555 0000"
            style={inputStyle}
          />
        </Field>

        <Field label="ລະຫັດຜ່ານ" hint="ຢ່າງໜ້ອຍ 8 ຕົວອັກສອນ">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
            style={inputStyle}
          />
        </Field>

        {/* An explicit tick, not a line of small print saying signing up counts
            as agreeing. The server records who accepted which version and when,
            and that record is only worth having if the person actually chose. */}
        <label
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            font: f(400, 12.5, 19),
            color: c.soft,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            required
            style={{ width: 24, height: 24, marginTop: 1, accentColor: c.accent, flexShrink: 0 }}
          />
          <span>
            ຂ້າພະເຈົ້າໄດ້ອ່ານ ແລະ ຍອມຮັບ{' '}
            <Link to="/p/terms" target="_blank" style={{ color: c.accent, fontWeight: 600 }}>
              ເງື່ອນໄຂການໃຊ້ບໍລິການ
            </Link>{' '}
            ແລະ{' '}
            <Link to="/p/privacy" target="_blank" style={{ color: c.accent, fontWeight: 600 }}>
              ນະໂຍບາຍຄວາມເປັນສ່ວນຕົວ
            </Link>
          </span>
        </label>

        {error != null && <ErrorNote error={error} />}

        <Button type="submit" size="lg" full disabled={busy || !acceptedTerms}>
          {busy ? <Spinner size={17} color="#fff" /> : 'ສະໝັກ'}
        </Button>
      </form>
    </AuthShell>
  );
}
