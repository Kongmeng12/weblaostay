import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { requestPasswordReset, resetPassword } from '../lib/api';
import { c, f, radius, type as t } from '../theme';
import { Button, ErrorNote, Field, inputStyle, Spinner } from '../components/ui';
import { AuthShell } from './SignIn';

/**
 * Ask for a reset, then use the token.
 *
 * The emailed link arrives as `/forgot?token=…`, so a token in the query means
 * the guest has already asked and is coming back to finish: that skips straight
 * to choosing a new password rather than making them ask a second time.
 *
 * Outside production the API also returns the token in the response
 * (`devToken`), so the flow can be tested without waiting on a mail server.
 */
export function ForgotPasswordPage() {
  const [params] = useSearchParams();
  const linked = params.get('token')?.trim() ?? '';

  const [stage, setStage] = useState<'request' | 'reset' | 'done'>(
    linked ? 'reset' : 'request',
  );
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(linked);
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
        subtitle={linked ? 'ເລືອກລະຫັດຜ່ານໃໝ່ຂອງທ່ານ' : 'ໃສ່ token ທີ່ໄດ້ຮັບ ພ້ອມລະຫັດຜ່ານໃໝ່'}
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
              ໂໝດພັດທະນາ: token ຖືກຕື່ມໃຫ້ອັດຕະໂນມັດ ບໍ່ຕ້ອງລໍອີເມວ
            </div>
          )}

          {!linked && (
            <Field label="Token">
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                style={inputStyle}
              />
            </Field>
          )}

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
        <Link to="/signin" style={{ font: t.label }}>
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
