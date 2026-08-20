import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { c, f, radius, type as t } from '../theme';
import { Button, Card, ErrorNote, Field, Loading, Page, PageTitle, Pill, Spinner, inputStyle } from '../components/ui';
import type { CustomerProfile } from '../lib/types';

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

            <Field label="ເບີໂທ" hint="ທີ່ພັກຈະຕິດຕໍ່ທ່ານທາງເບີນີ້">
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
