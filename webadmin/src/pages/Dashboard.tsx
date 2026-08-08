import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api';
import type { BookingRow, Dashboard as DashboardData, GmvSeries, Paged } from '../lib/types';
import { c, f, radius, pillFor, BOOKING_STATUS_PILL } from '../theme';
import { kip, kipShort, laoDateRange, deltaLabel, laoDate } from '../lib/format';
import { Card, CardTitle, DataTable, ErrorState, Pill, Button } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

const GMV_DAYS = 14;

export function Dashboard() {
  const navigate = useNavigate();
  const { can } = useAuth();

  const summary = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/admin/dashboard'),
  });
  const gmv = useQuery({
    queryKey: ['dashboard', 'gmv', GMV_DAYS],
    queryFn: () => api.get<GmvSeries>(`/admin/dashboard/gmv${qs({ days: GMV_DAYS })}`),
  });
  // The newest bookings are simply the first page of the bookings list, which is
  // already sorted newest-first — no endpoint of its own needed.
  const recent = useQuery({
    queryKey: ['dashboard', 'recent'],
    queryFn: () => api.get<Paged<BookingRow>>(`/admin/bookings${qs({ limit: 6 })}`),
  });

  if (summary.isError) {
    return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  }

  const k = summary.data;
  const pendingBookings = k?.bookingsByStatus.pending ?? 0;
  // The API reports lifetime totals, so the only honest trend is the one that
  // can be read off the series itself: this week against the one before it.
  const weekDelta = deltaLabel(weekOverWeek(gmv.data), 'vs ອາທິດກ່ອນ');

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
          label="ຍອດຂາຍລວມ · GMV"
          value={k ? kipShort(k.gmv) : '—'}
          note={weekDelta.text}
          noteColor={weekDelta.color}
          loading={summary.isLoading}
        />
        <KpiCard
          emoji="📈"
          emojiBg="#E7EAD7"
          label="ຄ່າຄອມມິຊຊັນລວມ"
          value={k ? kipShort(k.commission) : '—'}
          valueColor={c.accent}
          note={gmv.data ? `${kipShort(gmv.data.total)} ໃນ ${GMV_DAYS} ວັນ` : ''}
          noteColor={c.muted}
          loading={summary.isLoading}
        />
        <KpiCard
          emoji="🧾"
          emojiBg="#F3E6D8"
          label="ການຈອງທັງໝົດ"
          value={k ? String(k.bookings) : '—'}
          note={pendingBookings ? `${pendingBookings} ລໍຊຳລະ` : 'ບໍ່ມີລາຍການຄ້າງຊຳລະ'}
          noteColor={pendingBookings ? c.accent : c.muted}
          loading={summary.isLoading}
        />
        <KpiCard
          emoji="🏨"
          emojiBg="#E6E1CD"
          label="ທີ່ພັກເປີດຂາຍ"
          value={k ? String(k.activeProperties) : '—'}
          note={k?.pendingApprovals ? `${k.pendingApprovals} ລໍອະນຸມັດ` : 'ບໍ່ມີໃບສະໝັກຄ້າງ'}
          noteColor={k?.pendingApprovals ? c.accent : c.muted}
          loading={summary.isLoading}
        />
      </div>

      {/* chart + payout card */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginBottom: 22 }}>
        <Card>
          <CardTitle
            right={
              <span style={{ font: f(600, 12), color: c.muted }}>
                {gmv.data
                  ? `${GMV_DAYS} ວັນລ່າສຸດ · ສູງສຸດ ${kipShort(gmv.data.peak)}`
                  : `${GMV_DAYS} ວັນລ່າສຸດ`}
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
            {(gmv.data?.series ?? Array.from({ length: GMV_DAYS }, () => null)).map((point, i) => (
              <div
                key={point?.date ?? i}
                title={
                  point
                    ? `${laoDate(point.date)} · ${kip(point.total)} · ${point.bookings} ການຈອງ`
                    : ''
                }
                style={{
                  flex: 1,
                  // A zero day still needs a visible sliver, or the chart looks broken.
                  height: point ? `${Math.max(point.heightPercent, 2)}%` : '30%',
                  background: point ? (i >= GMV_DAYS - 2 ? c.accent : '#D9C0A0') : c.divider,
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
            {k ? kipShort(k.pendingPayouts.amount) : '—'}
          </div>
          <div style={{ font: f(400, 12), color: c.onDarkSoft, marginBottom: 'auto' }}>
            {!k
              ? 'ກຳລັງໂຫຼດ...'
              : k.pendingPayouts.count > 0
                ? `${k.pendingPayouts.count} ຮອບລໍໂອນ`
                : 'ບໍ່ມີຮອບຄ້າງ'}
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
          rows={recent.data?.items ?? []}
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

/**
 * The last seven days against the seven before them, as a percentage.
 *
 * Null when there is nothing to compare against — a first week of trading, or a
 * previous week with no takings at all. Showing "▲ ∞%" there would be worse
 * than showing nothing.
 */
function weekOverWeek(gmv: GmvSeries | undefined): number | null {
  if (!gmv || gmv.series.length < 14) return null;

  const sum = (from: number, to: number) =>
    gmv.series.slice(from, to).reduce((total, point) => total + point.total, 0);

  const previous = sum(gmv.series.length - 14, gmv.series.length - 7);
  const current = sum(gmv.series.length - 7, gmv.series.length);

  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
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
