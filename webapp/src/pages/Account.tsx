import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { c, f, radius, space, type as t } from '../theme';
import { Button, Card, ErrorNote, Field, Loading, Page, PageTitle, Pill, Spinner, inputStyle } from '../components/ui';
import type { CustomerProfile } from '../lib/types';
import { looksLikePhone } from '../lib/validation';

const NOTIF_KEY = 'phaphak.guest.notifPrefs';

interface NotifPrefs {
  emailOffers: boolean;
  tripReminders: boolean;
}

function loadNotifPrefs(): NotifPrefs {
  try {
    return JSON.parse(localStorage.getItem(NOTIF_KEY) ?? 'null') ?? { emailOffers: true, tripReminders: true };
  } catch {
    return { emailOffers: true, tripReminders: true };
  }
}

export function AccountPage() {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<CustomerProfile>('/customer/me'),
  });

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>(loadNotifPrefs);

  // Fill the form once. Re-filling on every refetch would wipe what is being
  // typed the moment a background refresh lands.
  useEffect(() => {
    if (query.data && !seeded) {
      setFullName(query.data.fullName ?? '');
      setPhone(query.data.phone ?? '');
      setSeeded(true);
    }
  }, [query.data, seeded]);

  const save = useMutation({
    mutationFn: () =>
      api.patch<CustomerProfile>('/customer/me', {
        fullName: fullName.trim(),
        phone: phone.trim(),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['profile'], data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2600);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!looksLikePhone(phone)) {
      setPhoneError('ໃສ່ເບີໂທທີ່ຖືກຕ້ອງ · Enter a valid phone number');
      return;
    }
    setPhoneError(null);
    save.mutate();
  }

  if (query.isLoading) return <Loading />;
  if (query.isError) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorNote error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const p = query.data!;

  return (
    <Page width="form">
      <PageTitle>ບັນຊີຂອງຂ້ອຍ</PageTitle>

      <div style={{ display: 'grid', gap: 16 }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div>
              <div style={{ font: f(800, 17), color: c.text }}>{p.fullName ?? p.email}</div>
              <div style={{ font: t.bodySm, color: c.muted }}>{p.email}</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Pill bg={c.infoBg} fg={c.infoFg}>
                {p.tier === 'gold' ? 'Gold' : 'Silver'}
              </Pill>
              {p.isVerified ? (
                <Pill bg={c.successBg} fg={c.successFg}>ຢືນຢັນແລ້ວ</Pill>
              ) : (
                <Pill bg={c.warnBg} fg={c.warnFg}>ຍັງບໍ່ຢືນຢັນ</Pill>
              )}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 10,
              marginTop: 18,
            }}
          >
            <Stat label="ການຈອງທັງໝົດ" value={p.bookings.total} />
            <Stat label="ກຳລັງຈະມາເຖິງ" value={p.bookings.upcoming} />
            <Stat label="ພັກຈົບແລ້ວ" value={p.bookings.completed} />
          </div>
        </Card>

        <Card>
          <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
            <div style={{ font: t.h3, color: c.text }}>ຂໍ້ມູນຕິດຕໍ່</div>

            <Field label="ຊື່ ແລະ ນາມສະກຸນ">
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                minLength={2}
                style={inputStyle}
              />
            </Field>

            <Field label="ເບີໂທ" hint="ທີ່ພັກຈະຕິດຕໍ່ທ່ານທາງເບີນີ້" error={phoneError}>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                minLength={6}
                style={inputStyle}
              />
            </Field>

            {save.isError && <ErrorNote error={save.error} />}

            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Spinner size={15} color="#fff" /> : 'ບັນທຶກ'}
              </Button>
              {saved && (
                <span style={{ font: t.caption, color: c.successFg }}>✓ ບັນທຶກແລ້ວ</span>
              )}
            </div>
          </form>
        </Card>

        <Card>
          <div style={{ font: t.h3, color: c.text, marginBottom: 16 }}>ການຕັ້ງຄ່າ</div>
          <div style={{ display: 'grid', gap: 14 }}>
            <NotifToggle
              label="ອີເມວ Offers ແລະ ໂປຣໂມຊັ່ນ"
              hint="ຮັບຂ່າວສານດີລ ແລະ ສ່ວນຫຼຸດ"
              checked={notifPrefs.emailOffers}
              onChange={(v) => {
                const next = { ...notifPrefs, emailOffers: v };
                setNotifPrefs(next);
                localStorage.setItem(NOTIF_KEY, JSON.stringify(next));
              }}
            />
            <NotifToggle
              label="ແຈ້ງເຕືອນການເດີນທາງ"
              hint="ຮັບແຈ້ງເຕືອນກ່ອນເຊັກອິນ 24 ຊົ່ວໂມງ"
              checked={notifPrefs.tripReminders}
              onChange={(v) => {
                const next = { ...notifPrefs, tripReminders: v };
                setNotifPrefs(next);
                localStorage.setItem(NOTIF_KEY, JSON.stringify(next));
              }}
            />
          </div>
        </Card>

        <Card>
          <div style={{ font: t.h3, color: c.text, marginBottom: 6 }}>ອອກຈາກລະບົບ</div>
          <p style={{ font: t.caption, color: c.muted, margin: '0 0 14px' }}>
            ອອກຈາກອຸປະກອນນີ້ — ການຈອງຂອງທ່ານຍັງຢູ່ຄືເກົ່າ
          </p>
          <Button variant="outline" onClick={() => void signOut()}>
            ອອກຈາກລະບົບ
          </Button>
        </Card>
      </div>
    </Page>
  );
}

function NotifToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
      <div>
        <div style={{ font: t.label, color: c.text }}>{label}</div>
        <div style={{ font: t.caption, color: c.muted, marginTop: 2 }}>{hint}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-checked={checked}
        role="switch"
        style={{
          width: 44,
          height: 26,
          borderRadius: 13,
          background: checked ? c.accent : c.border,
          border: 'none',
          cursor: 'pointer',
          position: 'relative',
          flexShrink: 0,
          transition: 'background 0.18s',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: checked ? 21 : 3,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            transition: 'left 0.18s',
          }}
        />
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: radius.md,
        padding: '12px 10px',
        textAlign: 'center',
      }}
    >
      <div style={{ font: t.h2, color: c.text }}>{value}</div>
      <div style={{ font: t.caption, color: c.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
}
