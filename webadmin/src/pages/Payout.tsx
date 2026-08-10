import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PayoutList, PayoutRow } from '../lib/types';
import { c, f, radius, pillFor, PAYOUT_STATUS_PILL, avatarFor } from '../theme';
import { kip, kipShort, laoDateRange, laoDateTime } from '../lib/format';
import {
  Card,
  DataTable,
  Pill,
  Chips,
  ErrorState,
  Button,
  Avatar,
  Modal,
} from '../components/ui';

/** Mirrors `payout_status`. */
type Filter = 'all' | 'pending' | 'processing' | 'paid' | 'failed';

export function Payout() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [payAllOpen, setPayAllOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

  const list = useQuery({
    queryKey: ['payouts', filter],
    queryFn: () =>
      api.get<PayoutList>('/admin/payouts' + (filter === 'all' ? '' : `?status=${filter}`)),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['payouts'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const payOne = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/payouts/${id}/pay`),
    onSuccess: invalidate,
  });

  const payAll = useMutation({
    mutationFn: () => api.post<{ paid: number; totalNet: number }>('/admin/payouts/pay-all'),
    onSuccess: () => {
      invalidate();
      setPayAllOpen(false);
    },
  });

  const generate = useMutation({
    mutationFn: () =>
      api.post<{ created: number; skipped: number; totalNet: number; periodStart: string; periodEnd: string }>(
        '/admin/payouts/generate',
      ),
    onSuccess: () => {
      invalidate();
      setGenerateOpen(false);
    },
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const data = list.data;

  return (
    <div>
      {/* summary strip */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: 16,
          marginBottom: 22,
        }}
      >
        <div
          style={{
            background: 'linear-gradient(140deg,#3A2A1E,#2C1E16)',
            borderRadius: radius.lg,
            padding: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
          }}
        >
          <div>
            <div style={{ font: f(600, 13), color: '#E9D8C6', marginBottom: 8 }}>
              ຍອດຄ້າງໂອນທັງໝົດ
            </div>
            <div style={{ font: f(800, 32), color: '#fff' }}>
              {data ? kip(data.pendingTotal) : '—'}
            </div>
            <div style={{ font: f(400, 12), color: c.onDarkSoft, marginTop: 6 }}>
              {data ? `${data.pendingCount} ລາຍການລໍໂອນ` : 'ກຳລັງໂຫຼດ...'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="ghost" size="lg" onClick={() => setGenerateOpen(true)}>
              ສ້າງຮອບໃໝ່
            </Button>
            <Button
              size="lg"
              disabled={!data?.pendingCount}
              onClick={() => setPayAllOpen(true)}
            >
              ຈ່າຍທັງໝົດ
            </Button>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <Chips<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'ທັງໝົດ' },
            { value: 'pending', label: 'ລໍໂອນ' },
            { value: 'paid', label: 'ໂອນແລ້ວ' },
            { value: 'failed', label: 'ລົ້ມເຫຼວ' },
          ]}
        />
      </div>

      <Card padding={0}>
        <DataTable
          loading={list.isLoading}
          rows={data?.items ?? []}
          keyOf={(r) => r.id}
          empty="ຍັງບໍ່ມີລາຍການໂອນເງິນ — ກົດ ‘ສ້າງຮອບໃໝ່’ ເພື່ອສ້າງຈາກການຈອງທີ່ພັກຈົບແລ້ວ"
          columns={[
            {
              key: 'partner',
              header: 'Partner',
              render: (r: PayoutRow) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <Avatar gradient={avatarFor(r.partnerId)} />
                  <div>
                    <div style={{ font: f(700, 13), color: c.text }}>{r.partnerName}</div>
                    <div style={{ font: f(400, 11), color: c.faint }}>
                      {r.bankName ?? '—'} {r.bankAccount ?? ''}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              key: 'period',
              header: 'ຮອບ',
              render: (r) => laoDateRange(r.periodStart, r.periodEnd),
            },
            { key: 'bookings', header: 'ການຈອງ', align: 'right', render: (r) => r.bookings },
            { key: 'gross', header: 'GMV', align: 'right', render: (r) => kip(r.gross) },
            {
              key: 'commission',
              header: 'ຄ່າຄອມ',
              align: 'right',
              render: (r) => <span style={{ color: c.muted }}>−{kip(r.commission)}</span>,
            },
            {
              key: 'net',
              header: 'ຍອດໂອນສຸດທິ',
              align: 'right',
              render: (r) => <b style={{ color: c.accent }}>{kip(r.net)}</b>,
            },
            {
              key: 'status',
              header: 'ສະຖານະ',
              render: (r) => {
                const p = pillFor(PAYOUT_STATUS_PILL, r.status);
                return (
                  <>
                    <Pill bg={p.bg} fg={p.fg}>{p.label}</Pill>
                    {r.paidAt && (
                      <div style={{ font: f(400, 10), color: c.faint, marginTop: 4 }}>
                        {laoDateTime(r.paidAt)}
                      </div>
                    )}
                  </>
                );
              },
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (r) =>
                r.status === 'pending' ? (
                  <Button
                    size="sm"
                    disabled={payOne.isPending}
                    onClick={() => payOne.mutate(r.id)}
                  >
                    ໂອນເງິນ
                  </Button>
                ) : (
                  <span style={{ font: f(600, 11), color: c.successFg }}>✓ ສຳເລັດ</span>
                ),
            },
          ]}
        />
      </Card>

      {payOne.error instanceof Error && (
        <div style={{ marginTop: 14 }}>
          <ErrorState error={payOne.error} />
        </div>
      )}

      {payAllOpen && (
        <Modal
          title="ຢືນຢັນການໂອນເງິນທັງໝົດ"
          onClose={() => setPayAllOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPayAllOpen(false)} disabled={payAll.isPending}>
                ຍົກເລີກ
              </Button>
              <Button onClick={() => payAll.mutate()} disabled={payAll.isPending}>
                {payAll.isPending ? 'ກຳລັງໂອນ...' : `ຢືນຢັນໂອນ ${kipShort(data?.pendingTotal ?? 0)}`}
              </Button>
            </>
          }
        >
          <div style={{ font: f(400, 13, 21), color: c.soft }}>
            ຈະໝາຍ <b>{data?.pendingCount}</b> ລາຍການເປັນ “ໂອນແລ້ວ” ລວມ{' '}
            <b style={{ color: c.accent }}>{kip(data?.pendingTotal ?? 0)}</b> ແລະ
            ແຈ້ງເຕືອນ Partner ທຸກຄົນ. ການກະທຳນີ້ຈະຖືກບັນທຶກໃນ audit log.
          </div>
          {payAll.error instanceof Error && (
            <div style={{ marginTop: 14, font: f(500, 12), color: c.dangerFg }}>
              {payAll.error.message}
            </div>
          )}
        </Modal>
      )}

      {generateOpen && (
        <Modal
          title="ສ້າງຮອບໂອນເງິນໃໝ່"
          onClose={() => setGenerateOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setGenerateOpen(false)} disabled={generate.isPending}>
                ຍົກເລີກ
              </Button>
              <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
                {generate.isPending ? 'ກຳລັງສ້າງ...' : 'ສ້າງຮອບ'}
              </Button>
            </>
          }
        >
          <div style={{ font: f(400, 13, 21), color: c.soft }}>
            ລະບົບຈະລວມການຈອງທີ່ <b>ພັກຈົບແລ້ວ</b> ຂອງອາທິດທີ່ຜ່ານມາ (ຈັນ–ອາທິດ) ຕໍ່ແຕ່ລະ Partner,
            ຫັກຄ່າຄອມມິຊຊັນຕາມຊ່ອງທາງ (App 5% / Walk-in 2.5%) ແລ້ວສ້າງລາຍການໂອນ.
            ຮອບທີ່ສ້າງໄປແລ້ວຈະຖືກຂ້າມ — ກົດຊ້ຳບໍ່ເຮັດໃຫ້ຈ່າຍຊ້ຳ.
          </div>
          {generate.data && (
            <div style={{ marginTop: 14, font: f(500, 12), color: c.successFg }}>
              ສ້າງ {generate.data.created} ລາຍການ · ຂ້າມ {generate.data.skipped}
            </div>
          )}
          {generate.error instanceof Error && (
            <div style={{ marginTop: 14, font: f(500, 12), color: c.dangerFg }}>
              {generate.error.message}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
