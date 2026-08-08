import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import type { Paged, BookingRow, BookingDetail as BookingDetailData } from '../lib/types';
import { c, f, pillFor, BOOKING_STATUS_PILL, PAYMENT_STATUS_PILL } from '../theme';
import { kip, laoDateRange, laoDateTime } from '../lib/format';
import {
  Card,
  DataTable,
  Pill,
  SearchInput,
  Chips,
  Pagination,
  ErrorState,
  Modal,
  Button,
  inputStyle,
  Field,
} from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { useDebounced } from '../lib/useDebounced';

/** `all` plus every `booking_status` the API accepts as a `?status=` filter. */
type StatusFilter =
  | 'all'
  | 'pending'
  | 'confirmed'
  | 'staying'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export function Bookings() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<BookingRow | null>(null);

  const q = useDebounced(search, 350);

  const counts = useQuery({
    queryKey: ['bookings', 'counts'],
    queryFn: () => api.get<Record<string, number>>('/admin/bookings/status-counts'),
  });

  const list = useQuery({
    queryKey: ['bookings', { status, q, page }],
    queryFn: () =>
      api.get<Paged<BookingRow>>(
        '/admin/bookings' + qs({ status: status === 'all' ? undefined : status, q, page, limit: 15 }),
      ),
  });

  const detail = useQuery({
    queryKey: ['bookings', 'detail', detailId],
    queryFn: () => api.get<BookingDetailData>(`/admin/bookings/${detailId}`),
    enabled: !!detailId,
  });

  const cancel = useMutation({
    mutationFn: (vars: { id: string; reason: string }) =>
      api.post(`/admin/bookings/${vars.id}/cancel`, { reason: vars.reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      setCancelTarget(null);
    },
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const cnt = counts.data ?? {};

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          marginBottom: 18,
          flexWrap: 'wrap',
        }}
      >
        <Chips<StatusFilter>
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: 'all', label: 'ທັງໝົດ', count: cnt.all },
            { value: 'pending', label: 'ລໍຊຳລະ', count: cnt.pending },
            { value: 'confirmed', label: 'ຢືນຢັນ', count: cnt.confirmed },
            { value: 'staying', label: 'ກຳລັງພັກ', count: cnt.staying },
            { value: 'completed', label: 'ສຳເລັດ', count: cnt.completed },
            { value: 'cancelled', label: 'ຍົກເລີກ', count: cnt.cancelled },
            { value: 'no_show', label: 'ບໍ່ມາ', count: cnt.no_show },
          ]}
        />
        {/* The API matches `q` against booking_code only, so the placeholder
            promises exactly that and no more. */}
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="ຄົ້ນຫາລະຫັດການຈອງ ເຊັ່ນ STL-03E9..."
          width={300}
        />
      </div>

      <Card padding={0}>
        <DataTable
          loading={list.isLoading}
          rows={list.data?.items ?? []}
          keyOf={(r) => r.id}
          onRowClick={(r) => setDetailId(r.id)}
          empty={q ? `ບໍ່ພົບການຈອງທີ່ກົງກັບ "${q}"` : 'ຍັງບໍ່ມີການຈອງ'}
          columns={[
            { key: 'code', header: 'ລະຫັດ', render: (r) => <b style={{ color: c.text }}>{r.code}</b> },
            {
              key: 'property',
              header: 'ທີ່ພັກ',
              render: (r) => <span style={{ color: c.text, fontWeight: 500 }}>{r.property}</span>,
            },
            { key: 'guest', header: 'ແຂກ', render: (r) => r.guest },
            {
              key: 'dates',
              header: 'ວັນທີ່',
              render: (r) => (
                <>
                  <div>{laoDateRange(r.checkIn, r.checkOut)}</div>
                  <div style={{ font: f(400, 11), color: c.faint }}>{r.nights} ຄືນ</div>
                </>
              ),
            },
            {
              key: 'source',
              header: 'ຊ່ອງທາງ',
              render: (r) => (
                <span
                  style={{ font: f(600, 11), color: r.source === 'walk_in' ? '#8A6B1F' : c.soft }}
                >
                  {r.source === 'walk_in' ? 'Walk-in' : 'App'}
                </span>
              ),
            },
            {
              key: 'commission',
              header: 'ຄອມ',
              align: 'right',
              render: (r) => <span style={{ color: c.soft }}>{kip(r.commission)}</span>,
            },
            {
              key: 'payment',
              header: 'ຊຳລະ',
              render: (r) => {
                const p = pillFor(PAYMENT_STATUS_PILL, r.paymentStatus);
                return <Pill bg={p.bg} fg={p.fg}>{p.label}</Pill>;
              },
            },
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
        {list.data && (
          <Pagination
            page={list.data.page}
            pages={list.data.pages}
            total={list.data.total}
            onChange={setPage}
          />
        )}
      </Card>

      {/* detail */}
      {detailId && (
        <Modal
          title="ລາຍລະອຽດການຈອງ"
          width={560}
          onClose={() => setDetailId(null)}
          footer={
            <>
              {/* The API refuses to cancel a stay that is already over or
                  already cancelled, so the button is not offered for those. */}
              {can('super_admin', 'finance') &&
                detail.data &&
                !['cancelled', 'completed', 'no_show'].includes(detail.data.status) && (
                  <Button
                    variant="danger"
                    onClick={() => {
                      const row = list.data?.items.find((b) => b.id === detailId);
                      if (row) {
                        setCancelTarget(row);
                        setDetailId(null);
                      }
                    }}
                  >
                    ຍົກເລີກ & ຄືນເງິນ
                  </Button>
                )}
              <Button variant="ghost" onClick={() => setDetailId(null)}>
                ປິດ
              </Button>
            </>
          }
        >
          {detail.isLoading ? (
            <div style={{ font: f(400, 13), color: c.muted }}>ກຳລັງໂຫຼດ...</div>
          ) : detail.data ? (
            <BookingDetail data={detail.data} />
          ) : (
            <div style={{ font: f(400, 13), color: c.dangerFg }}>ໂຫຼດບໍ່ໄດ້</div>
          )}
        </Modal>
      )}

      {/* cancel confirmation */}
      {cancelTarget && (
        <CancelDialog
          booking={cancelTarget}
          busy={cancel.isPending}
          error={cancel.error}
          onClose={() => setCancelTarget(null)}
          onConfirm={(reason) => cancel.mutate({ id: cancelTarget.id, reason })}
        />
      )}
    </div>
  );
}

function BookingDetail({ data: d }: { data: BookingDetailData }) {
  const pill = pillFor(BOOKING_STATUS_PILL, d.status);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ font: f(800, 20), color: c.text }}>{d.code}</span>
        <Pill bg={pill.bg} fg={pill.fg}>{pill.label}</Pill>
      </div>

      <Section title="ທີ່ພັກ">
        <Row label="ຊື່" value={d.property.name} />
        <Row
          label="ທີ່ຢູ່"
          value={[d.property.district, d.property.province, d.property.address]
            .filter(Boolean)
            .join(' · ')}
        />
        {d.roomType && (
          <Row
            label="ຫ້ອງ"
            value={`${d.roomType.name} × ${d.roomType.quantity} · ${kip(d.roomType.pricePerNight)}/ຄືນ`}
          />
        )}
        <Row
          label="Partner"
          value={[d.property.host, d.property.phone].filter(Boolean).join(' · ')}
        />
      </Section>

      <Section title="ແຂກ">
        <Row label="ຊື່" value={d.guest.name ?? '—'} />
        <Row label="ຕິດຕໍ່" value={[d.guest.phone, d.guest.email].filter(Boolean).join(' · ')} />
      </Section>

      <Section title="ການເຂົ້າພັກ">
        <Row label="ວັນທີ່" value={laoDateRange(d.checkIn, d.checkOut)} />
        <Row label="ຈຳນວນຄືນ" value={`${d.nights} ຄືນ · ${d.guests} ຄົນ`} />
        <Row label="ຊ່ອງທາງ" value={d.source === 'walk_in' ? 'Walk-in' : 'App'} />
        <Row label="ວັນຈອງ" value={laoDateTime(d.createdAt)} />
        {d.specialRequest && <Row label="ຄຳຂໍພິເສດ" value={d.specialRequest} />}
      </Section>

      <Section title="ຍອດເງິນ">
        <Row label="ຄ່າທີ່ພັກ" value={kip(d.subtotal)} />
        {d.serviceFee > 0 && <Row label="ຄ່າບໍລິການ" value={kip(d.serviceFee)} />}
        {d.tax > 0 && <Row label="ພາສີ" value={kip(d.tax)} />}
        {d.cleaningFee > 0 && <Row label="ຄ່າທຳຄວາມສະອາດ" value={kip(d.cleaningFee)} />}
        {d.discount > 0 && <Row label="ສ່ວນຫຼຸດ" value={`− ${kip(d.discount)}`} />}
        <Row label="ລວມ" value={kip(d.total)} strong />
        <Row label={`ຄອມມິຊຊັນ ${d.commissionRate}%`} value={kip(d.commission)} />
        <Row label="ຍອດໃຫ້ Partner" value={kip(d.payout)} />
      </Section>

      {d.payments.length > 0 && (
        <Section title="ການຊຳລະ">
          {d.payments.map((p) => (
            <Row
              key={p.id}
              label={pillFor(PAYMENT_STATUS_PILL, p.status).label}
              value={`${kip(p.amount)} · ${p.paidAt ? laoDateTime(p.paidAt) : 'ຍັງບໍ່ຈ່າຍ'}`}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ font: f(700, 13), color: c.accent, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ font: f(400, 13), color: c.muted }}>{label}</span>
      <span
        style={{
          font: f(strong ? 700 : 500, 13),
          color: strong ? c.accent : c.text,
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function CancelDialog({
  booking,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  booking: BookingRow;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Modal
      title={`ຍົກເລີກການຈອງ ${booking.code}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            ຍົກເລີກ
          </Button>
          <Button variant="danger" onClick={() => onConfirm(reason)} disabled={busy}>
            {busy ? 'ກຳລັງດຳເນີນການ...' : 'ຢືນຢັນຍົກເລີກ'}
          </Button>
        </>
      }
    >
      <div style={{ font: f(400, 13, 21), color: c.soft, marginBottom: 18 }}>
        ລະບົບຈະຫັກຄ່າທຳນຽມຍົກເລີກຕາມທີ່ຕັ້ງໄວ້ໃນໜ້າຕັ້ງຄ່າ, ຄືນເງິນສ່ວນທີ່ເຫຼືອ,
        ແລະ ປົດຫ້ອງກັບຄືນເປັນວ່າງ. ການກະທຳນີ້ຈະຖືກບັນທຶກໃນ audit log.
      </div>
      <Field label="ເຫດຜົນ">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="ເຊັ່ນ: ລູກຄ້າຂໍຍົກເລີກ"
          style={inputStyle}
        />
      </Field>
      {error instanceof Error && (
        <div style={{ marginTop: 14, font: f(500, 12), color: c.dangerFg }}>{error.message}</div>
      )}
    </Modal>
  );
}
