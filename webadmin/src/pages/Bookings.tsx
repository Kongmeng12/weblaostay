import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import type { Paged, BookingRow } from '../lib/types';
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

type StatusFilter = 'all' | 'pending' | 'confirmed' | 'staying' | 'done' | 'cancelled';

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
    queryFn: () => api.get<Record<string, unknown>>(`/admin/bookings/${detailId}`),
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
            { value: 'pending', label: 'ລໍຖ້າ', count: cnt.pending },
            { value: 'confirmed', label: 'ຢືນຢັນ', count: cnt.confirmed },
            { value: 'staying', label: 'ກຳລັງພັກ', count: cnt.staying },
            { value: 'done', label: 'ສຳເລັດ', count: cnt.done },
            { value: 'cancelled', label: 'ຍົກເລີກ', count: cnt.cancelled },
          ]}
        />
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="ຄົ້ນຫາ ລະຫັດ / ທີ່ພັກ / ແຂກ..."
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
              render: (r) => (
                <>
                  <div style={{ color: c.text, fontWeight: 500 }}>{r.property}</div>
                  <div style={{ font: f(400, 11), color: c.faint }}>
                    {r.province} · {r.room}
                  </div>
                </>
              ),
            },
            {
              key: 'guest',
              header: 'ແຂກ',
              render: (r) => (
                <>
                  <div style={{ color: c.text }}>{r.guest}</div>
                  <div style={{ font: f(400, 11), color: c.faint }}>{r.guests} ຄົນ</div>
                </>
              ),
            },
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
                <span style={{ font: f(600, 11), color: r.source === 'walk_in' ? '#8A6B1F' : c.soft }}>
                  {r.source === 'walk_in' ? 'Walk-in · 2.5%' : 'App · 5%'}
                </span>
              ),
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
              {can('super_admin', 'finance') &&
                detail.data &&
                (detail.data as { status?: string }).status !== 'cancelled' &&
                (detail.data as { status?: string }).status !== 'done' && (
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

function BookingDetail({ data }: { data: Record<string, unknown> }) {
  const d = data as {
    code: string;
    nights: number;
    guests: number;
    subtotal: number;
    fee: number;
    total: number;
    status: string;
    source: string;
    check_in: string;
    check_out: string;
    created_at: string;
    properties: { name: string; province: string; address: string; partners: { owner_name: string; phone: string } };
    users: { full_name: string; email: string; phone: string; tier: string };
    rooms: { name: string; room_no: string; bed_type: string; has_ac: boolean };
    payments: { status: string; amount: number; txn_ref: string | null; paid_at: string | null }[];
    cancellations: { reason: string | null; fee: number; refund_amount: number }[];
    promos: { code: string; type: string; value: number } | null;
  };

  const pill = pillFor(BOOKING_STATUS_PILL, d.status);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ font: f(800, 20), color: c.text }}>{d.code}</span>
        <Pill bg={pill.bg} fg={pill.fg}>{pill.label}</Pill>
      </div>

      <Section title="ທີ່ພັກ">
        <Row label="ຊື່" value={d.properties.name} />
        <Row label="ແຂວງ" value={d.properties.province} />
        <Row label="ຫ້ອງ" value={`${d.rooms.room_no ?? d.rooms.name} · ${d.rooms.has_ac ? 'ມີແອ' : 'ບໍ່ມີແອ'} · ${d.rooms.bed_type === 'double' ? 'ຕຽງຄູ່' : 'ຕຽງດຽວ'}`} />
        <Row label="Partner" value={`${d.properties.partners.owner_name} · ${d.properties.partners.phone}`} />
      </Section>

      <Section title="ແຂກ">
        <Row label="ຊື່" value={d.users.full_name} />
        <Row label="ຕິດຕໍ່" value={`${d.users.phone} · ${d.users.email}`} />
        <Row label="ຊັ້ນສະມາຊິກ" value={d.users.tier === 'gold' ? 'Gold' : 'Silver'} />
      </Section>

      <Section title="ການເຂົ້າພັກ">
        <Row label="ວັນທີ່" value={laoDateRange(d.check_in, d.check_out)} />
        <Row label="ຈຳນວນຄືນ" value={`${d.nights} ຄືນ · ${d.guests} ຄົນ`} />
        <Row label="ຊ່ອງທາງ" value={d.source === 'walk_in' ? 'Walk-in (ຄອມ 2.5%)' : 'App (ຄອມ 5%)'} />
        <Row label="ວັນຈອງ" value={laoDateTime(d.created_at)} />
      </Section>

      <Section title="ຍອດເງິນ">
        <Row label="ຄ່າທີ່ພັກ" value={kip(d.subtotal)} />
        <Row label="ຄ່າບໍລິການ" value={kip(d.fee)} />
        {d.promos && <Row label="ໂຄ້ດສ່ວນຫຼຸດ" value={d.promos.code} />}
        <Row label="ລວມ" value={kip(d.total)} strong />
        {d.payments.map((p, i) => (
          <Row
            key={i}
            label="ຊຳລະ"
            value={`${pillFor(PAYMENT_STATUS_PILL, p.status).label} · ${kip(p.amount)}${p.txn_ref ? ' · ' + p.txn_ref : ''}`}
          />
        ))}
        {d.cancellations.map((x, i) => (
          <Row key={i} label="ຄືນເງິນ" value={`ຫັກ ${kip(x.fee)} · ຄືນ ${kip(x.refund_amount)}`} />
        ))}
      </Section>
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
