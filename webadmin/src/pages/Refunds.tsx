import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { RefundCounts, RefundRow } from '../lib/types';
import { c, f, radius, pillFor, REFUND_STATUS_PILL } from '../theme';
import { kip, laoAgo, laoDateTime } from '../lib/format';
import { Button, Card, Chips, DataTable, ErrorState, Field, Modal, Pill, inputStyle } from '../components/ui';

type Filter = 'pending' | 'completed' | 'failed' | 'all';

/**
 * Money owed back to guests.
 *
 * A cancellation works out what is owed but sends nothing: PhaJay's refund API
 * returns a charge in full and takes no amount, while a cancellation policy
 * almost always keeps a percentage. So every refund is transferred by hand from
 * PhaJay's portal, and this screen is the queue of who is still waiting.
 */
export function Refunds() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('pending');
  const [paying, setPaying] = useState<RefundRow | null>(null);
  const [failing, setFailing] = useState<RefundRow | null>(null);

  const counts = useQuery({
    queryKey: ['refunds', 'counts'],
    queryFn: () => api.get<RefundCounts>('/admin/refunds/counts'),
    refetchInterval: 60_000,
  });

  const list = useQuery({
    queryKey: ['refunds', filter],
    queryFn: () =>
      api.get<RefundRow[]>('/admin/refunds' + (filter === 'all' ? '' : `?status=${filter}`)),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['refunds'] });

  const markPaid = useMutation({
    mutationFn: (v: { id: string; note?: string }) =>
      api.patch(`/admin/refunds/${v.id}/paid`, v.note ? { note: v.note } : {}),
    onSuccess: () => {
      invalidate();
      setPaying(null);
    },
  });

  const markFailed = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      api.patch(`/admin/refunds/${v.id}/failed`, { reason: v.reason }),
    onSuccess: () => {
      invalidate();
      setFailing(null);
    },
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const owed = counts.data?.pending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* What is outstanding, before anything else. Someone is waiting on it. */}
      {!!owed?.count && (
        <Card padding={20} style={{ background: c.warnBg, border: '1px solid #E8D4A8' }}>
          <div style={{ font: f(800, 20), color: c.warnFg }}>
            {owed.count} ຄົນລໍເງິນຄືນ · {kip(owed.amount)}
          </div>
          <div style={{ font: f(400, 12.5, 20), color: c.soft, marginTop: 6 }}>
            ໂອນຄືນຜ່ານ portal ຂອງ PhaJay ແລ້ວກັບມາກົດ <b>ບັນທຶກວ່າໂອນແລ້ວ</b> —
            ແຂກຈະໄດ້ຮັບແຈ້ງເຕືອນທັນທີ. ຄົ້ນຫາໃນ portal ດ້ວຍລະຫັດທຸລະກຳໃນຖັນ <b>txnRef</b>.
          </div>
        </Card>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Chips<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'pending', label: 'ລໍໂອນຄືນ', count: counts.data?.pending?.count },
            { value: 'completed', label: 'ໂອນແລ້ວ', count: counts.data?.completed?.count },
            { value: 'failed', label: 'ລົ້ມເຫຼວ', count: counts.data?.failed?.count },
            { value: 'all', label: 'ທັງໝົດ' },
          ]}
        />
      </div>

      <Card padding={0}>
        <DataTable
          loading={list.isLoading}
          rows={list.data ?? []}
          keyOf={(r) => r.id}
          empty={filter === 'pending' ? 'ບໍ່ມີໃຜລໍເງິນຄືນ' : 'ບໍ່ມີລາຍການ'}
          columns={[
            {
              key: 'booking',
              header: 'ການຈອງ',
              render: (r) => (
                <>
                  <div style={{ font: f(700, 13), color: c.text }}>{r.bookingCode}</div>
                  <div style={{ font: f(400, 11), color: c.faint }}>{r.property}</div>
                </>
              ),
            },
            {
              key: 'guest',
              header: 'ແຂກ',
              render: (r) => (
                <>
                  <div style={{ color: c.text, fontWeight: 500 }}>{r.guest}</div>
                  <div style={{ font: f(400, 11), color: c.faint }}>
                    {r.guestPhone ?? r.guestEmail}
                  </div>
                </>
              ),
            },
            {
              key: 'txn',
              header: 'txnRef',
              render: (r) =>
                r.txnRef ? (
                  <span
                    style={{
                      font: f(600, 11.5),
                      color: c.soft,
                      background: c.bg,
                      padding: '4px 8px',
                      borderRadius: 6,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.txnRef}
                  </span>
                ) : (
                  <span style={{ color: c.faint }}>—</span>
                ),
            },
            {
              key: 'amount',
              header: 'ຕ້ອງຄືນ',
              align: 'right',
              render: (r) => (
                <>
                  <div style={{ font: f(800, 14), color: c.accent }}>{kip(r.amount)}</div>
                  {/* The gap is the cancellation penalty, and the reason this
                      cannot go through PhaJay's all-or-nothing refund. */}
                  <div style={{ font: f(400, 10.5), color: c.faint }}>
                    ຈ່າຍມາ {kip(r.paid)}
                  </div>
                </>
              ),
            },
            {
              key: 'when',
              header: 'ຮ້ອງຂໍ',
              render: (r) => (
                <>
                  <div>{laoAgo(r.requestedAt)}</div>
                  {r.refundedAt && (
                    <div style={{ font: f(400, 10), color: c.faint }}>
                      ໂອນ {laoDateTime(r.refundedAt)}
                    </div>
                  )}
                </>
              ),
            },
            {
              key: 'status',
              header: 'ສະຖານະ',
              align: 'right',
              render: (r) => {
                const p = pillFor(REFUND_STATUS_PILL, r.status);
                return (
                  <Pill bg={p.bg} fg={p.fg}>
                    {p.label}
                  </Pill>
                );
              },
            },
            {
              key: 'do',
              header: '',
              align: 'right',
              render: (r) =>
                r.status === 'completed' ? null : (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <Button size="sm" onClick={() => setPaying(r)}>
                      ບັນທຶກວ່າໂອນແລ້ວ
                    </Button>
                    {r.status !== 'failed' && (
                      <Button size="sm" variant="danger" onClick={() => setFailing(r)}>
                        ລົ້ມເຫຼວ
                      </Button>
                    )}
                  </div>
                ),
            },
          ]}
        />
      </Card>

      {paying && (
        <ConfirmPaid
          refund={paying}
          busy={markPaid.isPending}
          error={markPaid.error}
          onClose={() => setPaying(null)}
          onSubmit={(note) => markPaid.mutate({ id: paying.id, note })}
        />
      )}

      {failing && (
        <ConfirmFailed
          refund={failing}
          busy={markFailed.isPending}
          error={markFailed.error}
          onClose={() => setFailing(null)}
          onSubmit={(reason) => markFailed.mutate({ id: failing.id, reason })}
        />
      )}
    </div>
  );
}

function ConfirmPaid({
  refund,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  refund: RefundRow;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (note?: string) => void;
}) {
  const [note, setNote] = useState('');

  return (
    <Modal
      title="ບັນທຶກວ່າໂອນຄືນແລ້ວ"
      width={480}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            ຍົກເລີກ
          </Button>
          <Button disabled={busy} onClick={() => onSubmit(note.trim() || undefined)}>
            {busy ? 'ກຳລັງບັນທຶກ...' : 'ຢືນຢັນ'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: c.bg, borderRadius: radius.md, padding: 14 }}>
          <div style={{ font: f(700, 14), color: c.text }}>{refund.guest}</div>
          <div style={{ font: f(400, 12), color: c.muted, marginTop: 2 }}>
            {refund.bookingCode} · {refund.property}
          </div>
          <div style={{ font: f(800, 20), color: c.accent, marginTop: 10 }}>
            {kip(refund.amount)}
          </div>
        </div>

        {/* The button records a transfer; it does not make one. */}
        <div style={{ font: f(500, 12.5, 20), color: c.warnFg, background: c.warnBg, padding: 12, borderRadius: radius.md }}>
          ກົດອັນນີ້<b>ຫຼັງ</b>ໂອນເງິນຜ່ານ portal ຂອງ PhaJay ແລ້ວເທົ່ານັ້ນ — ມັນບໍ່ໄດ້ໂອນເງິນໃຫ້.
          ແຂງຈະໄດ້ຮັບແຈ້ງເຕືອນວ່າຄືນສຳເລັດ.
        </div>

        <Field label="ໝາຍເຫດ" hint="ເລກອ້າງອີງການໂອນ ຫຼື ອື່ນໆ — ບໍ່ບັງຄັບ">
          <input value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} />
        </Field>

        {error instanceof Error && (
          <div style={{ font: f(500, 12), color: c.dangerFg }}>{error.message}</div>
        )}
      </div>
    </Modal>
  );
}

function ConfirmFailed({
  refund,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  refund: RefundRow;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Modal
      title="ບັນທຶກວ່າໂອນຄືນບໍ່ໄດ້"
      width={460}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            ຍົກເລີກ
          </Button>
          <Button variant="danger" disabled={busy || reason.trim().length < 3} onClick={() => onSubmit(reason.trim())}>
            {busy ? 'ກຳລັງບັນທຶກ...' : 'ບັນທຶກ'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ font: f(400, 12.5, 20), color: c.muted }}>
          {refund.bookingCode} · {refund.guest} · {kip(refund.amount)}
        </div>
        <Field label="ເປັນຫຍັງຈຶ່ງໂອນບໍ່ໄດ້" hint="ຈະຖືກເກັບໄວ້ໃນບັນທຶກ">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="ເລກບັນຊີບໍ່ຖືກຕ້ອງ"
            style={inputStyle}
          />
        </Field>
        {error instanceof Error && (
          <div style={{ font: f(500, 12), color: c.dangerFg }}>{error.message}</div>
        )}
      </div>
    </Modal>
  );
}
