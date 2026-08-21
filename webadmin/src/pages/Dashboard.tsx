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
      <div className="adm-kpis" style={{ marginBottom: 22 }}>
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

      {/* chart + payout card.
          `alignItems: start` on purpose: the payout card holds four short lines
          and stretching it to the chart's height left a hand's width of empty
          brown in the middle of the page. */}
      <div className="adm-split" style={{ marginBottom: 22 }}>
        <GmvChart data={gmv.data} loading={gmv.isLoading} />

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
          {k ? (
            <>
              <div style={{ font: f(800, 30), color: '#fff', marginBottom: 6 }}>
                {kipShort(k.pendingPayouts.amount)}
              </div>
              <div style={{ font: f(400, 12), color: c.onDarkSoft }}>
                {k.pendingPayouts.count > 0
                  ? `${k.pendingPayouts.count} ຮອບລໍໂອນ`
                  : 'ບໍ່ມີຮອບຄ້າງ'}
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  height: 38,
                  width: '55%',
                  borderRadius: radius.sm,
                  background: 'rgba(255,255,255,.10)',
                  marginBottom: 8,
                  animation: 'phaphakPulse 1.2s ease-in-out infinite',
                }}
              />
              <div
                style={{
                  height: 14,
                  width: '35%',
                  borderRadius: radius.sm,
                  background: 'rgba(255,255,255,.07)',
                  animation: 'phaphakPulse 1.2s ease-in-out infinite',
                }}
              />
            </>
          )}
          {can('super_admin', 'finance') ? (
            <Button size="lg" onClick={() => navigate('/payout')} style={{ marginTop: 18 }}>
              ຈັດການໂອນເງິນ →
            </Button>
          ) : (
            <div style={{ marginTop: 18, font: f(400, 12), color: '#8C7F6C' }}>
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

const PLOT_HEIGHT = 190;

/**
 * Daily takings for the last fortnight.
 *
 * A real platform has quiet days, and a run of them used to render as fourteen
 * identical two-pixel stubs floating in white — indistinguishable from a chart
 * that had failed to load. So the bars now sit on a baseline, the peak is drawn
 * as a labelled gridline to give the heights a scale, and a fortnight with no
 * takings at all says so in words instead of drawing nothing fourteen times.
 */
function GmvChart({ data, loading }: { data: GmvSeries | undefined; loading: boolean }) {
  const today = data?.series.at(-1)?.date;

  return (
    <Card>
      <CardTitle
        right={
          <span style={{ font: f(600, 12), color: c.muted }}>
            {data ? `${GMV_DAYS} ວັນລ່າສຸດ · ລວມ ${kipShort(data.total)}` : `${GMV_DAYS} ວັນລ່າສຸດ`}
          </span>
        }
      >
        ຍອດຂາຍຕໍ່ວັນ · Daily GMV
      </CardTitle>

      {data && data.total === 0 ? (
        <div
          style={{
            height: PLOT_HEIGHT,
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            background: c.bg,
            borderRadius: radius.md,
          }}
        >
          <div>
            <div style={{ font: f(700, 14), color: c.soft }}>ບໍ່ມີຍອດຂາຍໃນ {GMV_DAYS} ວັນນີ້</div>
            <div style={{ font: f(400, 12), color: c.muted, marginTop: 4 }}>
              ການຈອງທີ່ຊຳລະແລ້ວຈະຂຶ້ນຢູ່ນີ້
            </div>
          </div>
        </div>
      ) : (
        <div style={{ position: 'relative', paddingTop: 18 }}>
          {/* peak gridline — without a scale the bars are just shapes */}
          {data && (
            <>
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 18,
                  borderTop: `1px dashed ${c.border}`,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  font: f(600, 10),
                  color: c.faint,
                }}
              >
                {kipShort(data.peak)}
              </div>
            </>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 6,
              height: PLOT_HEIGHT,
              borderBottom: `1px solid ${c.border}`,
            }}
          >
            {(data?.series ?? Array.from({ length: GMV_DAYS }, () => null)).map((point, i) => {
              const isToday = !!point && point.date === today;
              return (
                <div
                  key={point?.date ?? i}
                  title={
                    point
                      ? `${laoDate(point.date)} · ${kip(point.total)} · ${point.bookings} ການຈອງ`
                      : ''
                  }
                  style={{
                    flex: 1,
                    // A day with no takings keeps a sliver on the baseline so the
                    // column is still hoverable and the row still reads as a chart.
                    height: point ? `${Math.max(point.heightPercent, 1.5)}%` : '28%',
                    background: !point
                      ? c.divider
                      : point.total === 0
                        ? c.border
                        : isToday
                          ? c.accent
                          : '#D9C0A0',
                    borderRadius: '5px 5px 0 0',
                    opacity: loading ? 0.4 : 1,
                    transition: 'height .3s, opacity .2s',
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 8,
          font: f(400, 10),
          color: c.faint,
        }}
      >
        <span>{data?.series[0] ? laoDate(data.series[0].date) : ''}</span>
        <span>{data?.series.at(-1) ? `${laoDate(data.series.at(-1)!.date)} · ມື້ນີ້` : ''}</span>
      </div>
    </Card>
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
      {/* A dash reads as "nothing to show". While the figure is still in flight
          — and against a remote database that is a second or two — a pulsing
          bar says "not yet" instead. */}
      {loading ? (
        <div
          style={{
            height: 34,
            width: '62%',
            borderRadius: radius.sm,
            background: c.bg,
            animation: 'phaphakPulse 1.2s ease-in-out infinite',
          }}
        />
      ) : (
        <div style={{ font: f(800, 26), color: valueColor }}>{value}</div>
      )}
      {/* Held back while loading: every note has a "nothing to report" fallback,
          and printing "no applications pending" before the figures arrive is a
          claim the page cannot yet make. */}
      <div style={{ font: f(600, 12), color: noteColor, marginTop: 4, minHeight: 18 }}>
        {loading ? '' : note}
      </div>
    </Card>
  );
}
