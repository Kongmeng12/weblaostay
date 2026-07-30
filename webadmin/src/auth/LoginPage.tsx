import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthContext';
import { c, f, radius } from '../theme';
import { Button, inputStyle } from '../components/ui';

/**
 * Login and first-run registration, laid out as the two-panel card from the
 * design: dark brand side on the left, form on the right.
 */
export function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await signIn(email.trim(), password);
      else await signUp(email.trim(), name.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ເຂົ້າສູ່ລະບົບບໍ່ໄດ້');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
        background: c.pageOuter,
        minHeight: '100vh',
        fontFamily: "'Noto Sans Lao', sans-serif",
      }}
    >
      <div
        style={{
          width: 1100,
          maxWidth: '100%',
          minHeight: 640,
          borderRadius: radius.lg,
          overflow: 'hidden',
          background: '#fff',
          boxShadow: '0 30px 70px -20px rgba(40,30,20,.5)',
          display: 'flex',
        }}
      >
        {/* brand panel */}
        <div
          style={{
            flex: 1,
            background: `linear-gradient(150deg, ${c.sidebarFrom}, #241B15 70%)`,
            padding: 48,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: c.accent,
                display: 'grid',
                placeItems: 'center',
                font: f(800, 20),
                color: '#fff',
              }}
            >
              L
            </div>
            <div>
              <div style={{ font: f(800, 18), color: '#fff' }}>LaoStay</div>
              <div style={{ font: f(400, 12), color: c.onDarkSoft }}>ພັກເຮືອນລາວ</div>
            </div>
          </div>

          <div>
            <div style={{ font: f(800, 34, 44), color: '#fff', marginBottom: 14 }}>
              ຈັດການແພລດຟອມ
              <br />
              ຈອງທີ່ພັກທົ່ວລາວ
            </div>
            <div style={{ font: f(400, 14, 24), color: c.onDark, maxWidth: 380 }}>
              ດູແລການຈອງ, ອະນຸມັດ Partner, ໂອນເງິນລາຍສັປດາຫ໌ ແລະ ຕິດຕາມລາຍໄດ້ — ຈາກບ່ອນດຽວ.
            </div>
          </div>

          <div style={{ font: f(400, 12), color: '#8C7F6C' }}>
            © 2026 LaoStay · ສະຫງວນລິຂະສິດ
          </div>
        </div>

        {/* form panel */}
        <div
          style={{
            width: 460,
            flex: 'none',
            padding: 48,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div style={{ font: f(800, 26), color: c.text, marginBottom: 6 }}>
            {mode === 'login' ? 'ເຂົ້າສູ່ລະບົບ' : 'ສ້າງບັນຊີຜູ້ດູແລ'}
          </div>
          <div style={{ font: f(400, 13), color: c.muted, marginBottom: 28 }}>
            {mode === 'login'
              ? 'ໃສ່ອີເມວ ແລະ ລະຫັດຜ່ານຂອງທ່ານ'
              : 'ບັນຊີ super_admin ທຳອິດຂອງລະບົບ'}
          </div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {mode === 'register' && (
              <label>
                <span
                  style={{ font: f(600, 13), color: c.text, display: 'block', marginBottom: 8 }}
                >
                  ຊື່ ແລະ ນາມສະກຸນ
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                  style={inputStyle}
                  placeholder="ອຳນວຍ ຈັນດາ"
                />
              </label>
            )}

            <label>
              <span style={{ font: f(600, 13), color: c.text, display: 'block', marginBottom: 8 }}>
                ອີເມວ
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                style={inputStyle}
                placeholder="admin@laostay.la"
              />
            </label>

            <label>
              <span style={{ font: f(600, 13), color: c.text, display: 'block', marginBottom: 8 }}>
                ລະຫັດຜ່ານ
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                style={inputStyle}
                placeholder="••••••••"
              />
            </label>

            {error && (
              <div
                style={{
                  background: c.dangerBg,
                  border: '1px solid #F8C5B2',
                  borderRadius: radius.md,
                  padding: '12px 14px',
                  font: f(500, 12, 19),
                  color: c.dangerFg,
                }}
              >
                {error}
              </div>
            )}

            <Button type="submit" size="lg" disabled={busy} style={{ marginTop: 4 }}>
              {busy ? 'ກຳລັງດຳເນີນການ...' : mode === 'login' ? 'ເຂົ້າສູ່ລະບົບ' : 'ສ້າງບັນຊີ'}
            </Button>
          </form>

          <div style={{ marginTop: 22, font: f(400, 12), color: c.muted, textAlign: 'center' }}>
            {mode === 'login' ? (
              <>
                ຍັງບໍ່ມີບັນຊີຜູ້ດູແລ?{' '}
                <button
                  onClick={() => {
                    setMode('register');
                    setError(null);
                  }}
                  style={linkButton}
                >
                  ສ້າງບັນຊີທຳອິດ
                </button>
              </>
            ) : (
              <>
                ມີບັນຊີແລ້ວ?{' '}
                <button
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                  style={linkButton}
                >
                  ເຂົ້າສູ່ລະບົບ
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const linkButton = {
  background: 'none',
  border: 'none',
  color: c.accent,
  font: f(700, 12),
  cursor: 'pointer',
  padding: 0,
} as const;
