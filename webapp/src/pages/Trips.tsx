import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { c, f, radius, BOOKING_STATUS_PILL, pillFor, type as t } from '../theme';
import { countdown, kip, laoDateRange } from '../lib/format';
import { Button, Empty, ErrorNote, Page, PageTitle, Photo, Pill, Skeleton } from '../components/ui';
import type { BookingRow, Paged } from '../lib/types';

const FILTERS = [
  { value: '', label: 'ທັງໝົດ' },
  { value: 'pending', label: 'ລໍຊຳລະ' },
  { value: 'confirmed', label: 'ຢືນຢັນແລ້ວ' },
  { value: 'staying', label: 'ກຳລັງພັກ' },
  { value: 'completed', label: 'ພັກຈົບແລ້ວ' },
  { value: 'cancelled', label: 'ຍົກເລີກ' },
] as const;

export function TripsPage() {
  const [status, setStatus] = useState('');

  const query = useQuery({
    queryKey: ['trips', status],
    queryFn: () => api.get<Paged<BookingRow>>('/customer/bookings' + qs({ status, limit: 50 })),
    // A pending booking's hold is ticking down, so the list must not go stale.
    refetchInterval: status === '' || status === 'pending' ? 30_000 : false,
  });

  return (
    <Page width="wide">
      <PageTitle>ການເດີນທາງຂອງຂ້ອຍ</PageTitle>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {FILTERS.map((filter) => (
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
      ) : query.data?.items.length ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {query.data.items.map((b) => (
            <TripRow key={b.id} booking={b} />
          ))}
        </div>
      ) : (
        <Empty
          icon="🧳"
          message={status ? 'ບໍ່ມີການຈອງໃນສະຖານະນີ້' : 'ຍັງບໍ່ມີການຈອງ'}
          hint="ຄົ້ນຫາທີ່ພັກແລ້ວຈອງ — ການຈອງຂອງທ່ານຈະປາກົດຢູ່ນີ້"
          action={
            <Link to="/search">
              <Button size="lg">ຄົ້ນຫາທີ່ພັກ</Button>
            </Link>
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
        background: c.surface,
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

        {/* The one thing on this row that is about to change on its own. */}
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
