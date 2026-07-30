import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { Kpis, GmvSeries, RecentBooking, PayoutSummary } from '../lib/types';
import { c, f, radius, pillFor, BOOKING_STATUS_PILL } from '../theme';
import { kip, kipShort, laoDateRange, deltaLabel, laoDate } from '../lib/format';
import { Card, CardTitle, DataTable, ErrorState, Pill, Button } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

export function Dashboard() {
  const navigate = useNavigate();
  const { can } = useAuth();

  const kpis = useQuery({ queryKey: ['dashboard', 'kpis'], queryFn: () => api.get<Kpis>('/admin/dashboard/kpis') });
  const gmv = useQuery({ queryKey: ['dashboard', 'gmv'], queryFn: () => api.get<GmvSeries>('/admin/dashboard/gmv?days=14') });
  const recent = useQuery({ queryKey: ['dashboard', 'recent'], queryFn: () => api.get<RecentBooking[]>('/admin/dashboard/recent-bookings?limit=6') });
  const payout = useQuery({ queryKey: ['dashboard', 'payout'], queryFn: () => api.get<PayoutSummary>('/admin/dashboard/payout-summary') });

  if (kpis.isError) return <ErrorState error={kpis.error} onRetry={() => void kpis.refetch()} />;

  const k = kpis.data;
  const revenueDelta = deltaLabel(k?.revenue.deltaPercent);
  const commissionDelta = deltaLabel(k?.commission.deltaPercent);

  return (
    <div>
      {/* KPI row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          marginBottom: 22,
        }}
      >
        <KpiCard
          emoji="💰"
          emojiBg="#FFE3D6"
          label="ລາຍໄດ້ລວມ (ເດືອນນີ້)"
          value={k ? kipShort(k.revenue.value) : '—'}
          note={revenueDelta.text}
          noteColor={revenueDelta.color}
          loading={kpis.isLoading}
        />
        <KpiCard
          emoji="📈"
          emojiBg="#E7EAD7"
          label="ຄ່າຄອມມິຊຊັນ"
          value={k ? kipShort(k.commission.value) : '—'}
          valueColor={c.accent}
          note={commissionDelta.text}
          noteColor={commissionDelta.color}
          loading={kpis.isLoading}
        />
        <KpiCard
          emoji="🧾"
          emojiBg="#F3E6D8"
          label="ການຈອງ (ເດືອນນີ້)"
          value={k ? String(k.bookings.value) : '—'}
          note={k ? `▲ ${k.bookings.today} ມື້ນີ້` : ''}
          noteColor="#6E7B4E"
          loading={kpis.isLoading}
        />
        <KpiCard
          emoji="🤝"
          emojiBg="#E6E1CD"
          label="Partner ໃໝ່ (ເດືອນນີ້)"
          value={k ? String(k.newPartners.value) : '—'}
          note={k ? `${k.newPartners.pendingApprovals} ລໍອະນຸມັດ` : ''}
          noteColor={c.accent}
          loading={kpis.isLoading}
        />
      </div>

      {/* chart + payout card */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginBottom: 22 }}>
        <Card>
          <CardTitle
            right={
              <span style={{ font: f(600, 12), color: c.muted }}>
                {gmv.data ? `14 ວັນລ່າສຸດ · ສູງສຸດ ${kipShort(gmv.data.peak)}` : '14 ວັນລ່າສຸດ'}
              </span>
            }
          >
            ຍອດຂາຍຕໍ່ວັນ · Daily GMV
          </CardTitle>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              height: 180,
              gap: 6,
            }}
          >
            {(gmv.data?.series ?? Array.from({ length: 14 }, () => null)).map((point, i) => (
              <div
                key={point?.date ?? i}
                title={point ? `${laoDate(point.date)} · ${kip(point.total)}` : ''}
                style={{
                  flex: 1,
                  // A zero day still needs a visible sliver, or the chart looks broken.
                  height: point ? `${Math.max(point.heightPercent, 2)}%` : '30%',
                  background: point
                    ? i >= 12
                      ? c.accent
                      : '#D9C0A0'
                    : c.divider,
                  borderRadius: '5px 5px 0 0',
                  transition: 'height .3s',
                }}
              />
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 10,
              font: f(400, 10),
              color: c.faint,
            }}
          >
            <span>{gmv.data?.series[0] ? laoDate(gmv.data.series[0].date) : ''}</span>
            <span>
              {gmv.data?.series.at(-1) ? laoDate(gmv.data.series.at(-1)!.date) : ''}
            </span>
          </div>
        </Card>

        <div
          style={{
            background: 'linear-gradient(140deg,#3A2A1E,#2C1E16)',
            borderRadius: radius.lg,
            padding: 22,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ font: f(600, 13), color: '#E9D8C6', marginBottom: 8 }}>
            ຍອດຕ້ອງໂອນໃຫ້ Partner
          </div>
          <div style={{ font: f(800, 30), color: '#fff', marginBottom: 6 }}>
            {payout.data ? kipShort(payout.data.pendingTotal) : '—'}
          </div>
          <div style={{ font: f(400, 12), color: c.onDarkSoft, marginBottom: 'auto' }}>
            {payout.data
              ? `${payout.data.partnerCount} partner · ${
                  payout.data.periodStart
                    ? laoDateRange(payout.data.periodStart, payout.data.periodEnd)
                    : 'ບໍ່ມີຮອບຄ້າງ'
                }`
              : 'ກຳລັງໂຫຼດ...'}
          </div>
          {can('super_admin', 'finance') ? (
            <Button size="lg" onClick={() => navigate('/payout')} style={{ marginTop: 20 }}>
              ຈັດການໂອນເງິນ →
            </Button>
          ) : (
            <div style={{ marginTop: 20, font: f(400, 12), color: '#8C7F6C' }}>
              ຕ້ອງມີສິດ finance ຈຶ່ງຈັດການໂອນເງິນໄດ້
            </div>
          )}
        </div>
      </div>

      {/* recent bookings */}
      <Card padding={0}>
        <div
          style={{
            padding: '18px 22px',
            borderBottom: `1px solid ${c.divider}`,
            font: f(700, 16),
            color: c.text,
          }}
        >
          ການຈອງລ່າສຸດ · Recent bookings
        </div>
        <DataTable
          loading={recent.isLoading}
          rows={recent.data ?? []}
          keyOf={(r) => r.id}
          onRowClick={() => navigate('/bookings')}
          empty="ຍັງບໍ່ມີການຈອງ"
          columns={[
            { key: 'code', header: 'ລະຫັດ', render: (r) => <b style={{ color: c.text }}>{r.code}</b> },
            { key: 'property', header: 'ທີ່ພັກ', render: (r) => <span style={{ color: c.text, fontWeight: 500 }}>{r.property}</span> },
            { key: 'guest', header: 'ແຂກ', render: (r) => r.guest },
            { key: 'date', header: 'ວັນທີ່', render: (r) => laoDateRange(r.checkIn, r.checkOut) },
            {
              key: 'total',
              header: 'ຍອດ',
              align: 'right',
              render: (r) => <b style={{ color: c.accent }}>{kip(r.total)}</b>,
            },
            {
              key: 'status',
              header: 'ສະຖານະ',
              align: 'right',
              render: (r) => {
                const p = pillFor(BOOKING_STATUS_PILL, r.status);
                return <Pill bg={p.bg} fg={p.fg}>{p.label}</Pill>;
              },
            },
          ]}
        />
      </Card>
    </div>
  );
}

function KpiCard({
  emoji,
  emojiBg,
  label,
  value,
  valueColor = c.text,
  note,
  noteColor,
  loading,
}: {
  emoji: string;
  emojiBg: string;
  label: string;
  value: string;
  valueColor?: string;
  note: string;
  noteColor: string;
  loading?: boolean;
}) {
  return (
    <Card padding={18}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: radius.md,
            background: emojiBg,
            display: 'grid',
            placeItems: 'center',
            fontSize: 18,
          }}
        >
          {emoji}
        </div>
        <span style={{ font: f(400, 12), color: c.muted }}>{label}</span>
      </div>
      <div
        style={{
          font: f(800, 26),
          color: valueColor,
          opacity: loading ? 0.35 : 1,
          transition: 'opacity .2s',
        }}
      >
        {value}
      </div>
      <div style={{ font: f(600, 12), color: noteColor, marginTop: 4, minHeight: 18 }}>{note}</div>
    </Card>
  );
}
