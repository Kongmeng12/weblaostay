import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { requestPasswordReset, resetPassword } from '../lib/api';
import { c, f, radius } from '../theme';
import { Button, ErrorNote, Field, inputStyle, Spinner } from '../components/ui';
import { AuthShell } from './SignIn';

/**
 * Ask for a reset, then use the token.
 *
 * Outside production the API returns the token in the response (`devToken`) —
 * there is no email gateway wired up yet, and the endpoint would otherwise be
 * impossible to test. In production it returns nothing and **nothing sends the
 * token**, so this flow is a dead end until an email provider exists. The note
 * at the bottom says so rather than leaving a guest waiting for a mail that is
 * never coming.
 */
export function ForgotPasswordPage() {
  const [stage, setStage] = useState<'request' | 'reset' | 'done'>('request');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function ask(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await requestPasswordReset(email.trim());
      setDevToken(res.devToken ?? null);
      if (res.devToken) setToken(res.devToken);
      setStage('reset');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function apply(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await resetPassword(token.trim(), password);
      setStage('done');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'done') {
    return (
      <AuthShell title="ຕັ້ງລະຫັດຜ່ານໃໝ່ແລ້ວ" subtitle="ເຂົ້າສູ່ລະບົບດ້ວຍລະຫັດຜ່ານໃໝ່ໄດ້ເລີຍ">
        <Link to="/signin">
          <Button size="lg" full>
            ໄປໜ້າເຂົ້າສູ່ລະບົບ
          </Button>
        </Link>
      </AuthShell>
    );
  }

  if (stage === 'reset') {
    return (
      <AuthShell
        title="ຕັ້ງລະຫັດຜ່ານໃໝ່"
        subtitle="ໃສ່ token ທີ່ໄດ້ຮັບ ພ້ອມລະຫັດຜ່ານໃໝ່"
      >
        <form onSubmit={apply} style={{ display: 'grid', gap: 16 }}>
          {devToken && (
            <div
              style={{
                background: c.warnBg,
                border: '1px solid #E8D4A8',
                borderRadius: radius.md,
                padding: '12px 14px',
                font: f(500, 12, 19),
                color: c.warnFg,
              }}
            >
              ໂໝດພັດທະນາ: token ຖືກຕື່ມໃຫ້ອັດຕະໂນມັດ ເພາະຍັງບໍ່ມີລະບົບສົ່ງອີເມວ
            </div>
          )}

          <Field label="Token">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              style={inputStyle}
            />
          </Field>

          <Field label="ລະຫັດຜ່ານໃໝ່" hint="ຢ່າງໜ້ອຍ 8 ຕົວອັກສອນ">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              style={inputStyle}
            />
          </Field>

          {error != null && <ErrorNote error={error} />}

          <Button type="submit" size="lg" full disabled={busy}>
            {busy ? <Spinner size={17} color="#fff" /> : 'ບັນທຶກລະຫັດຜ່ານໃໝ່'}
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="ລືມລະຫັດຜ່ານ"
      subtitle="ໃສ່ອີເມວທີ່ໃຊ້ສະໝັກ ແລ້ວເຮົາຈະສົ່ງລິ້ງຕັ້ງລະຫັດຜ່ານໃໝ່ໃຫ້"
      footer={
        <Link to="/signin" style={{ font: f(700, 13) }}>
          ກັບໄປໜ້າເຂົ້າສູ່ລະບົບ
        </Link>
      }
    >
      <form onSubmit={ask} style={{ display: 'grid', gap: 16 }}>
        <Field label="ອີເມວ">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            style={inputStyle}
          />
        </Field>

        {error != null && <ErrorNote error={error} />}

        <Button type="submit" size="lg" full disabled={busy}>
          {busy ? <Spinner size={17} color="#fff" /> : 'ສົ່ງລິ້ງຕັ້ງລະຫັດຜ່ານໃໝ່'}
        </Button>

        <p style={{ font: f(400, 11.5, 18), color: c.faint, margin: 0, textAlign: 'center' }}>
          ຖ້າອີເມວນີ້ມີໃນລະບົບ ທ່ານຈະໄດ້ຮັບລິ້ງ — ເຮົາບໍ່ບອກວ່າມີ ຫຼື ບໍ່ມີ ເພື່ອຄວາມປອດໄພ
        </p>
      </form>
    </AuthShell>
  );
}
