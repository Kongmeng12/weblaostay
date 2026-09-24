import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { c, f, radius, BOOKING_STATUS_PILL, pillFor, type as t } from '../theme';
import { countdown, kip, laoDateRange } from '../lib/format';
import { Button, Empty, ErrorNote, Page, PageTitle, Photo, Pill, Skeleton } from '../components/ui';
import type { BookingRow, Paged } from '../lib/types';

type Tab = 'upcoming' | 'history';

const UPCOMING_STATUSES = new Set(['pending', 'confirmed', 'staying']);
// A booking the guest never turned up for is over too — leaving `no_show` out
// made it vanish from both tabs whenever the sub-filter was "all".
const HISTORY_STATUSES = new Set(['completed', 'cancelled', 'no_show']);

const UPCOMING_FILTERS = [
  { value: '', label: 'ທັງໝົດ' },
  { value: 'pending', label: 'ລໍຊຳລະ' },
  { value: 'confirmed', label: 'ຢືນຢັນ' },
  { value: 'staying', label: 'ກຳລັງພັກ' },
] as const;

const HISTORY_FILTERS = [
  { value: '', label: 'ທັງໝົດ' },
  { value: 'completed', label: 'ພັກຈົບ' },
  { value: 'cancelled', label: 'ຍົກເລີກ' },
  { value: 'no_show', label: 'ບໍ່ໄດ້ໄປ' },
] as const;

export function TripsPage() {
  const [tab, setTab] = useState<Tab>('upcoming');
  const [status, setStatus] = useState('');

  const query = useQuery({
    queryKey: ['trips', status],
    queryFn: () => api.get<Paged<BookingRow>>('/customer/bookings' + qs({ status, limit: 50 })),
    refetchInterval: tab === 'upcoming' && (status === '' || status === 'pending') ? 30_000 : false,
  });

  // When sub-filter is "all" (status=''), the API returns every booking status.
  // Client-side narrow to what the active tab actually represents.
  const items = (query.data?.items ?? []).filter((b) => {
    if (status !== '') return true;
    return tab === 'upcoming' ? UPCOMING_STATUSES.has(b.status) : HISTORY_STATUSES.has(b.status);
  });

  function switchTab(next: Tab) {
    setTab(next);
    setStatus('');
  }

  const filters = tab === 'upcoming' ? UPCOMING_FILTERS : HISTORY_FILTERS;

  return (
    <Page width="wide">
      <PageTitle>ການເດີນທາງຂອງຂ້ອຍ</PageTitle>

      {/* Main tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: `1px solid ${c.border}`,
          marginBottom: 16,
        }}
      >
        {([['upcoming', 'ຈອງໄວ້'] as const, ['history', 'ປະຫວັດ'] as const]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => switchTab(key)}
            style={{
              padding: '10px 20px',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${tab === key ? c.accent : 'transparent'}`,
              font: f(tab === key ? 700 : 400, 14),
              color: tab === key ? c.accent : c.muted,
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Sub-filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {filters.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setStatus(filter.value)}
            style={{
              padding: '8px 14px',
              borderRadius: 999,
              border: `1px solid ${status === filter.value ? c.accent : c.border}`,
              background: status === filter.value ? c.accentSoft : '#fff',
              color: status === filter.value ? c.accentDark : c.soft,
              font: t.caption,
              cursor: 'pointer',
            }}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {query.isError && <ErrorNote error={query.error} onRetry={() => void query.refetch()} />}

      {query.isLoading ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} height={128} />
          ))}
        </div>
      ) : items.length ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map((b) => (
            <TripRow key={b.id} booking={b} />
          ))}
        </div>
      ) : (
        <Empty
          icon={tab === 'upcoming' ? '🗓️' : '🧳'}
          message={
            status
              ? 'ບໍ່ມີການຈອງໃນສະຖານະນີ້'
              : tab === 'upcoming'
                ? 'ຍັງບໍ່ມີການຈອງທີ່ຈະມາ'
                : 'ຍັງບໍ່ມີປະຫວັດການຈອງ'
          }
          hint={
            tab === 'upcoming'
              ? 'ຄົ້ນຫາທີ່ພັກ ແລ້ວຈອງ — ການຈອງຂອງທ່ານຈະປາກົດຢູ່ນີ້'
              : 'ການຈອງທີ່ສຳເລັດ ຫຼື ຍົກເລີກຈະປາກົດຢູ່ນີ້'
          }
          action={
            tab === 'upcoming' ? (
              <Link to="/search">
                <Button size="lg">ຄົ້ນຫາທີ່ພັກ</Button>
              </Link>
            ) : undefined
          }
        />
      )}
    </Page>
  );
}

function TripRow({ booking }: { booking: BookingRow }) {
  const pill = pillFor(BOOKING_STATUS_PILL, booking.status);
  const remaining = booking.status === 'pending' ? countdown(booking.holdExpiresAt) : null;

  return (
    <Link
      to={`/trips/${booking.id}`}
      style={{
        display: 'flex',
        gap: 14,
        padding: 14,
        background: '#fff',
        border: `1px solid ${c.border}`,
        borderRadius: radius.lg,
        color: 'inherit',
      }}
    >
      <Photo url={booking.photo} alt={booking.property} height={92} width={120} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
          <span style={{ font: t.caption, color: c.faint }}>{booking.code}</span>
          <Pill bg={pill.bg} fg={pill.fg}>
            {pill.label}
          </Pill>
        </div>

        <div
          style={{
            font: t.h3,
            color: c.text,
            marginBottom: 3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {booking.property}
        </div>

        <div style={{ font: t.caption, color: c.muted }}>
          {laoDateRange(booking.checkIn, booking.checkOut)} · {booking.nights} ຄືນ ·{' '}
          {booking.guests} ຄົນ
          {booking.roomType ? ` · ${booking.roomType}` : ''}
        </div>

        {booking.status === 'pending' && (
          <div style={{ font: t.caption, color: c.warnFg, marginTop: 6 }}>
            {remaining ? `ຕ້ອງຊຳລະພາຍໃນ ${remaining}` : 'ໝົດເວລາກັນຫ້ອງແລ້ວ'}
          </div>
        )}
      </div>

      <div style={{ textAlign: 'right', flex: 'none' }}>
        <div style={{ font: f(800, 16), color: c.accent }}>{kip(booking.total)}</div>
        {booking.status === 'completed' && !booking.reviewed && (
          <div style={{ font: t.caption, color: c.accentDark, marginTop: 6 }}>ຂຽນຮີວິວ →</div>
        )}
      </div>
    </Link>
  );
}
