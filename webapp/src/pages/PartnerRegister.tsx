import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, request } from '../lib/api';
import { c, f, radius, shadow, type as t, TAP, PROPERTY_TYPE_LABEL } from '../theme';
import { Button, ErrorNote, Field, Page, Spinner, inputStyle } from '../components/ui';
import { looksLikeEmail, looksLikePhone } from '../lib/validation';
import type { District, Province } from '../lib/types';

const TYPES = Object.entries(PROPERTY_TYPE_LABEL);

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

export function PartnerRegisterPage() {
  const navigate = useNavigate();

  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [propertyName, setPropertyName] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [provinceId, setProvinceId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [address, setAddress] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [emailError, setEmailError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const { data: provinces } = useQuery({
    queryKey: ['provinces'],
    queryFn: () => api.get<Province[]>('/locations/provinces'),
    staleTime: 60 * 60 * 1000,
  });

  const { data: districts } = useQuery({
    queryKey: ['districts', provinceId],
    queryFn: () => api.get<District[]>(`/locations/districts?provinceId=${provinceId}`),
    enabled: !!provinceId,
    staleTime: 60 * 60 * 1000,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const emailOk = looksLikeEmail(email);
    const phoneOk = looksLikePhone(phone);
    setEmailError(emailOk ? null : 'ໃສ່ອີເມວທີ່ຖືກຕ້ອງ · Enter a valid email');
    setPhoneError(phoneOk ? null : 'ໃສ່ເບີໂທທີ່ຖືກຕ້ອງ · Enter a valid phone number');
    if (!emailOk || !phoneOk) return;

    setBusy(true);
    try {
      await request('/auth/register/partner', {
        method: 'POST',
        body: {
          email,
          password,
          ownerName,
          phone,
          businessName,
          propertyName,
          propertyType,
          provinceId: Number(provinceId),
          ...(districtId ? { districtId: Number(districtId) } : {}),
          address,
          acceptedTerms,
        },
        anonymous: true,
      });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Page width="form">
        <div
          style={{
            background: c.surface,
            border: `1px solid ${c.border}`,
            borderRadius: radius.lg,
            boxShadow: shadow.card,
            padding: 32,
            textAlign: 'center',
          }}
        >
          <div style={{ font: f(400, 48), marginBottom: 16, lineHeight: 1 }}>🎉</div>
          <h1 style={{ font: t.h1, color: c.text, margin: '0 0 10px' }}>ສົ່ງຄຳຂໍສຳເລັດ</h1>
          <p style={{ font: t.body, color: c.muted, margin: '0 0 8px' }}>
            ທີມງານ PhaPhak ຈະກວດສອບຂໍ້ມູນ ແລະ ຕິດຕໍ່ທ່ານທາງອີເມວ
          </p>
          <p style={{ font: t.bodySm, color: c.faint, margin: '0 0 28px' }}>
            ພາຍໃນ 1–2 ວັນເຮັດການ
          </p>
          <Button type="button" variant="outline" onClick={() => navigate('/')}>
            ກັບໜ້າຫຼັກ
          </Button>
        </div>
      </Page>
    );
  }

  return (
    <Page width="form">
      <div
        style={{
          background: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: radius.lg,
          boxShadow: shadow.card,
          padding: 28,
        }}
      >
        <h1 style={{ font: t.h1, color: c.text, margin: '0 0 6px' }}>ສະໝັກເປັນ Partner</h1>
        <p style={{ font: t.bodySm, color: c.muted, margin: '0 0 24px' }}>
          ລົງທະບຽນທີ່ພັກຂອງທ່ານກັບ PhaPhak — ຮັບການຈອງ ແລະ ຊຳລະທຸກວັນ
        </p>

        <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
          <GroupLabel>ຂໍ້ມູນເຈົ້າຂອງ</GroupLabel>

          <Field label="ຊື່ ແລະ ນາມສະກຸນ (ເຈົ້າຂອງ)">
            <input
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              required
              minLength={2}
              autoComplete="name"
              placeholder="ທ. ສີ ທອງ ວົງ"
              style={inputStyle}
            />
          </Field>

          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            }}
          >
            <Field label="ອີເມວ" error={emailError}>
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

            <Field label="ເບີໂທ" error={phoneError}>
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
          </div>

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

          <GroupLabel>ຂໍ້ມູນທີ່ພັກ</GroupLabel>

          <Field label="ຊື່ທຸລະກິດ / ບໍລິສັດ">
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
              minLength={2}
              placeholder="ວິລ່າ ສຸດາ ຈຳກັດ"
              style={inputStyle}
            />
          </Field>

          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            }}
          >
            <Field label="ຊື່ທີ່ພັກ">
              <input
                value={propertyName}
                onChange={(e) => setPropertyName(e.target.value)}
                required
                minLength={2}
                placeholder="ວິລ່າ ສຸດາ"
                style={inputStyle}
              />
            </Field>

            <Field label="ປະເພດ">
              <select
                value={propertyType}
                onChange={(e) => setPropertyType(e.target.value)}
                required
                style={selectStyle}
              >
                <option value="">ເລືອກປະເພດ</option>
                {TYPES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <GroupLabel>ທີ່ຕັ້ງ</GroupLabel>

          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            }}
          >
            <Field label="ແຂວງ">
              <select
                value={provinceId}
                onChange={(e) => {
                  setProvinceId(e.target.value);
                  setDistrictId('');
                }}
                required
                style={selectStyle}
              >
                <option value="">ເລືອກແຂວງ</option>
                {provinces?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>

            {!!provinceId && (
              <Field label="ເມືອງ">
                <select
                  value={districtId}
                  onChange={(e) => setDistrictId(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">ທຸກເມືອງ</option>
                  {districts?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          <Field label="ທີ່ຢູ່ລະອຽດ">
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              minLength={4}
              rows={3}
              placeholder="ບ້ານ, ເມືອງ, ແຂວງ..."
              style={{ ...inputStyle, height: 'auto', padding: '10px 12px', resize: 'vertical' }}
            />
          </Field>

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
            {busy ? <Spinner size={17} color="#fff" /> : 'ສົ່ງຄຳຂໍລົງທະບຽນ'}
          </Button>

          <div
            style={{
              paddingTop: 18,
              borderTop: `1px solid ${c.divider}`,
              font: t.bodySm,
              color: c.muted,
              textAlign: 'center',
            }}
          >
            ມີບັນຊີ Partner ແລ້ວ?{' '}
            <Link
              to="/signin"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: TAP,
                font: t.label,
                color: c.accent,
              }}
            >
              ເຂົ້າສູ່ລະບົບ
            </Link>
          </div>
        </form>
      </div>
    </Page>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        font: f(700, 13),
        color: c.soft,
        paddingBottom: 8,
        borderBottom: `1px solid ${c.divider}`,
        marginTop: 8,
      }}
    >
      {children}
    </div>
  );
}
