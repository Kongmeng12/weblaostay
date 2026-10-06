import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Paged, PartnerRow, PayoutDetail, PayoutList, PayoutRow } from '../lib/types';
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
  inputStyle,
} from '../components/ui';

/** Mirrors `payout_status`. */
type StatusFilter = 'all' | 'pending' | 'processing' | 'paid' | 'failed';
type PeriodFilter = 'all' | 'weekly' | 'monthly';

const LAO_MONTHS = [
  'ມັງກອນ','ກຸມພາ','ມີນາ','ເມສາ','ພຶດສະພາ','ມິຖຸນາ',
  'ກໍລະກົດ','ສິງຫາ','ກັນຍາ','ຕຸລາ','ພະຈິກ','ທັນວາ',
];

function detectPeriodType(start: string, end: string): 'weekly' | 'monthly' {
  const diff = (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000;
  return diff >= 27 ? 'monthly' : 'weekly';
}

export function Payout() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all');
  const [monthFilter, setMonthFilter] = useState('');
  const [payAllOpen, setPayAllOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [viewing, setViewing] = useState<PayoutRow | null>(null);

  const list = useQuery({
    queryKey: ['payouts', statusFilter],
    queryFn: () =>
      api.get<PayoutList>('/admin/payouts' + (statusFilter === 'all' ? '' : `?status=${statusFilter}`)),
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
    mutationFn: (params: { periodType: 'weekly' | 'monthly'; partnerIds: string[] }) =>
      api.post<{ created: number; skipped: number; totalNet: number; periodStart: string; periodEnd: string }>(
        '/admin/payouts/generate',
        params,
      ),
    onSuccess: () => {
      invalidate();
      setGenerateOpen(false);
    },
  });

  const filteredRows = useMemo(() => {
    let rows = list.data?.items ?? [];
    if (periodFilter !== 'all') {
      rows = rows.filter((r) => detectPeriodType(r.periodStart, r.periodEnd) === periodFilter);
    }
    if (monthFilter) {
      rows = rows.filter(
        (r) => String(new Date(r.periodStart).getMonth() + 1) === monthFilter,
      );
    }
    return rows;
  }, [list.data, periodFilter, monthFilter]);

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const data = list.data;

  return (
    <div>
      {/* summary strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16, marginBottom: 22 }}>
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
            <div style={{ font: f(600, 13), color: '#E9D8C6', marginBottom: 8 }}>ຍອດຄ້າງໂອນທັງໝົດ</div>
            <div style={{ font: f(800, 32), color: '#fff' }}>{data ? kip(data.pendingTotal) : '—'}</div>
            <div style={{ font: f(400, 12), color: c.onDarkSoft, marginTop: 6 }}>
              {data ? `${data.pendingCount} ລາຍການລໍໂອນ` : 'ກຳລັງໂຫຼດ...'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="ghost" size="lg" onClick={() => setGenerateOpen(true)}>
              ສ້າງຮອບໃໝ່
            </Button>
            <Button size="lg" disabled={!data?.pendingCount} onClick={() => setPayAllOpen(true)}>
              ຈ່າຍທັງໝົດ
            </Button>
          </div>
        </div>
      </div>

      {/* filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <Chips<StatusFilter>
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: 'ທັງໝົດ' },
            { value: 'pending', label: 'ລໍໂອນ' },
            { value: 'paid', label: 'ໂອນແລ້ວ' },
            { value: 'failed', label: 'ລົ້ມເຫຼວ' },
          ]}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 8 }}>
          <Chips<PeriodFilter>
            value={periodFilter}
            onChange={setPeriodFilter}
            options={[
              { value: 'all', label: 'ທຸກຮອບ' },
              { value: 'weekly', label: 'ອາທິດ' },
              { value: 'monthly', label: 'ເດືອນ' },
            ]}
          />
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            style={{ ...inputStyle, width: 140 }}
          >
            <option value="">ທຸກເດືອນ</option>
            {LAO_MONTHS.map((m, i) => (
              <option key={i + 1} value={String(i + 1)}>{m}</option>
            ))}
          </select>
          {(periodFilter !== 'all' || monthFilter) && (
            <button
              onClick={() => { setPeriodFilter('all'); setMonthFilter(''); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', font: f(500, 12), color: c.accent, padding: '0 4px' }}
            >
              ລ້າງ ✕
            </button>
          )}
        </div>
      </div>

      <Card padding={0}>
        <DataTable
          loading={list.isLoading}
          rows={filteredRows}
          keyOf={(r) => r.id}
          empty="ຍັງບໍ່ມີລາຍການໂອນເງິນ — ກົດ 'ສ້າງຮອບໃໝ່' ເພື່ອສ້າງຈາກການຈອງທີ່ພັກຈົບແລ້ວ"
          columns={[
            {
              key: 'partner',
              header: 'Partner',
              render: (r: PayoutRow) => (
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer' }}
                  onClick={() => setViewing(r)}
                >
                  <Avatar gradient={avatarFor(r.partnerId)} />
                  <div>
                    <div style={{ font: f(700, 13), color: c.accent, textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
                      {r.partnerName}
                    </div>
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
              render: (r) => (
                <>
                  <div>{laoDateRange(r.periodStart, r.periodEnd)}</div>
                  <div style={{ font: f(500, 10), color: c.faint, marginTop: 2 }}>
                    {detectPeriodType(r.periodStart, r.periodEnd) === 'monthly' ? 'ລາຍເດືອນ' : '7 ມື້'}
                  </div>
                </>
              ),
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
                  <Button size="sm" disabled={payOne.isPending} onClick={() => payOne.mutate(r.id)}>
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
            ຈະໝາຍ <b>{data?.pendingCount}</b> ລາຍການເປັນ "ໂອນແລ້ວ" ລວມ{' '}
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

      {viewing && (
        <PayoutItemsModal row={viewing} onClose={() => setViewing(null)} />
      )}

      {generateOpen && (
        <GenerateModal
          onClose={() => { setGenerateOpen(false); generate.reset(); }}
          onSubmit={(params) => generate.mutate(params)}
          busy={generate.isPending}
          result={generate.data}
          error={generate.error}
        />
      )}
    </div>
  );
}

// ── Payout Items Modal ────────────────────────────────────────────────────────

function PayoutItemsModal({ row, onClose }: { row: PayoutRow; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['payout-items', row.id],
    queryFn: () => api.get<PayoutDetail>(`/admin/payouts/${row.id}/items`),
  });

  const p = pillFor(PAYOUT_STATUS_PILL, row.status);

  return (
    <Modal
      title={`${row.partnerName} · ${laoDateRange(row.periodStart, row.periodEnd)}`}
      width={600}
      onClose={onClose}
      footer={<Button variant="ghost" onClick={onClose}>ປິດ</Button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* summary strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 10,
            background: c.bg,
            borderRadius: radius.md,
            padding: '12px 16px',
          }}
        >
          <SummaryCell label="ສະຖານະ"><Pill bg={p.bg} fg={p.fg}>{p.label}</Pill></SummaryCell>
          <SummaryCell label="GMV">{kip(row.gross)}</SummaryCell>
          <SummaryCell label="ຄ່າຄອມ"><span style={{ color: c.muted }}>−{kip(row.commission)}</span></SummaryCell>
          <SummaryCell label="ໂອນສຸດທິ"><b style={{ color: c.accent }}>{kip(row.net)}</b></SummaryCell>
        </div>

        {/* booking items */}
        {detail.isLoading && (
          <div style={{ font: f(400, 13), color: c.muted, textAlign: 'center', padding: 20 }}>
            ກຳລັງໂຫຼດ...
          </div>
        )}
        {detail.isError && (
          <div style={{ font: f(500, 12), color: c.dangerFg }}>
            {detail.error instanceof Error ? detail.error.message : 'ໂຫຼດບໍ່ສຳເລັດ'}
          </div>
        )}
        {detail.data && (
          <div style={{ border: `1px solid ${c.border}`, borderRadius: radius.md, overflow: 'hidden' }}>
            {/* header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr 90px 90px 90px',
                padding: '8px 14px',
                background: c.bg,
                font: f(600, 11),
                color: c.muted,
                borderBottom: `1px solid ${c.border}`,
              }}
            >
              <span>ໃບຈອງ</span>
              <span>ວັນທີ່ພັກ</span>
              <span style={{ textAlign: 'right' }}>GMV</span>
              <span style={{ textAlign: 'right' }}>ຄ່າຄອມ</span>
              <span style={{ textAlign: 'right' }}>ສຸດທິ</span>
            </div>
            {detail.data.items.map((item, i) => (
              <div
                key={item.bookingId}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 1fr 90px 90px 90px',
                  padding: '10px 14px',
                  borderTop: i > 0 ? `1px solid ${c.divider}` : undefined,
                  alignItems: 'center',
                }}
              >
                <span style={{ font: f(700, 12), color: c.text }}>{item.code}</span>
                <span style={{ font: f(400, 11), color: c.faint }}>
                  {laoDateRange(item.checkIn, item.checkOut)}
                  {item.source === 'walkin' && (
                    <span style={{ marginLeft: 6, font: f(500, 10), color: c.warnFg, background: c.warnBg, padding: '1px 5px', borderRadius: 4 }}>
                      walk-in
                    </span>
                  )}
                </span>
                <span style={{ font: f(600, 12), color: c.soft, textAlign: 'right' }}>{kip(item.gross)}</span>
                <span style={{ font: f(400, 11), color: c.muted, textAlign: 'right' }}>−{kip(item.commission)}</span>
                <span style={{ font: f(700, 12), color: c.accent, textAlign: 'right' }}>{kip(item.net)}</span>
              </div>
            ))}
            {detail.data.items.length === 0 && (
              <div style={{ padding: 20, font: f(400, 13), color: c.faint, textAlign: 'center' }}>
                ບໍ່ມີ booking ໃນຮອບນີ້
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function SummaryCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ font: f(500, 10), color: c.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ font: f(600, 13), color: c.text }}>{children}</div>
    </div>
  );
}

// ── Period preview helpers ────────────────────────────────────────────────────

function getWeeklyPeriod(): { start: Date; end: Date } {
  const now = new Date();
  const anchor = new Date(now.getTime() - 7 * 86_400_000);
  const dow = anchor.getUTCDay();
  const toMon = dow === 0 ? -6 : 1 - dow;
  const start = new Date(anchor.getTime() + toMon * 86_400_000);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return { start, end };
}

function getMonthlyPeriod(): { start: Date; end: Date } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const pm = m === 0 ? 11 : m - 1;
  const py = m === 0 ? y - 1 : y;
  return {
    start: new Date(Date.UTC(py, pm, 1)),
    end: new Date(Date.UTC(py, pm + 1, 0)),
  };
}

function fmtDate(d: Date) {
  return `${d.getUTCDate()} ${LAO_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ── Generate Modal ────────────────────────────────────────────────────────────

function GenerateModal({
  onClose,
  onSubmit,
  busy,
  result,
  error,
}: {
  onClose: () => void;
  onSubmit: (params: { periodType: 'weekly' | 'monthly'; partnerIds: string[] }) => void;
  busy: boolean;
  result?: { created: number; skipped: number };
  error: unknown;
}) {
  const [periodType, setPeriodType] = useState<'weekly' | 'monthly'>('weekly');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const partners = useQuery({
    queryKey: ['partners-payout-list'],
    queryFn: () => api.get<Paged<PartnerRow>>('/admin/partners?status=verified&limit=200'),
  });

  const period = periodType === 'weekly' ? getWeeklyPeriod() : getMonthlyPeriod();

  const visiblePartners = useMemo(() => {
    const items = partners.data?.items ?? [];
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter((p) => p.businessName.toLowerCase().includes(q));
  }, [partners.data, search]);

  const allIds = useMemo(() => (partners.data?.items ?? []).map((p) => p.id), [partners.data]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const noneSelected = selected.size === 0;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = () => {
    // empty set = all partners (backend default behaviour)
    onSubmit({ periodType, partnerIds: [...selected] });
  };

  return (
    <Modal
      title="ສ້າງຮອບໂອນເງິນໃໝ່"
      width={540}
      onClose={onClose}
      footer={
        result ? (
          <Button onClick={onClose}>ປິດ</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>ຍົກເລີກ</Button>
            <Button onClick={handleSubmit} disabled={busy}>
              {busy ? 'ກຳລັງສ້າງ...' : 'ສ້າງຮອບ'}
            </Button>
          </>
        )
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* ─── Period type ─── */}
        <div>
          <div style={{ font: f(600, 12), color: c.muted, marginBottom: 10 }}>ປະເພດຮອບ</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {(['weekly', 'monthly'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setPeriodType(t)}
                style={{
                  flex: 1,
                  padding: '12px 0',
                  borderRadius: radius.md,
                  border: `2px solid ${periodType === t ? c.accent : c.border}`,
                  background: periodType === t ? c.accentSoft : c.surface,
                  cursor: 'pointer',
                  font: f(700, 14),
                  color: periodType === t ? c.accentDark : c.soft,
                }}
              >
                {t === 'weekly' ? '7 ມື້' : '1 ເດືອນ'}
                <div style={{ font: f(400, 11), marginTop: 4, color: periodType === t ? c.accent : c.muted }}>
                  {t === 'weekly' ? 'ຈັນ–ອາທິດ' : 'ທ້ອນເດືອນ'}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ─── Period preview ─── */}
        <div
          style={{
            background: c.bg,
            borderRadius: radius.md,
            padding: '10px 14px',
            font: f(600, 13),
            color: c.text,
          }}
        >
          ຮອບ: {fmtDate(period.start)} – {fmtDate(period.end)}
        </div>

        {/* ─── Partner filter ─── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ font: f(600, 12), color: c.muted }}>
              Partner ({selected.size === 0 ? 'ທັງໝົດ' : `${selected.size} ທີ່ເລືອກ`})
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={() => setSelected(new Set(allIds))}
                disabled={allSelected}
                style={{ background: 'none', border: 'none', font: f(500, 12), color: c.infoFg, cursor: 'pointer' }}
              >
                ເລືອກທັງໝົດ
              </button>
              <button
                onClick={() => setSelected(new Set())}
                disabled={noneSelected}
                style={{ background: 'none', border: 'none', font: f(500, 12), color: c.muted, cursor: 'pointer' }}
              >
                ລ້າງ
              </button>
            </div>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ຄົ້ນຫາ Partner..."
            style={{ ...inputStyle, width: '100%', marginBottom: 8 }}
          />
          <div
            style={{
              border: `1px solid ${c.border}`,
              borderRadius: radius.md,
              maxHeight: 220,
              overflowY: 'auto',
            }}
          >
            {partners.isLoading && (
              <div style={{ padding: 16, font: f(400, 13), color: c.muted }}>ກຳລັງໂຫຼດ...</div>
            )}
            {visiblePartners.map((p, i) => (
              <label
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  cursor: 'pointer',
                  borderTop: i > 0 ? `1px solid ${c.divider}` : undefined,
                  background: selected.has(p.id) ? c.accentSoft : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                  style={{ accentColor: c.accent, width: 15, height: 15 }}
                />
                <Avatar gradient={avatarFor(p.id)} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: f(600, 13), color: c.text }}>{p.businessName}</div>
                  {p.ownerName && (
                    <div style={{ font: f(400, 11), color: c.faint }}>{p.ownerName}</div>
                  )}
                </div>
              </label>
            ))}
            {!partners.isLoading && visiblePartners.length === 0 && (
              <div style={{ padding: 16, font: f(400, 13), color: c.faint }}>ບໍ່ພົບ Partner</div>
            )}
          </div>
          <div style={{ font: f(400, 11), color: c.muted, marginTop: 6 }}>
            {noneSelected
              ? 'ຖ້າບໍ່ເລືອກ = ສ້າງໃຫ້ທຸກ Partner ທີ່ມີການຈອງໃນຮອບນີ້'
              : `ສ້າງສະເພາະ ${selected.size} Partner ທີ່ເລືອກ`}
          </div>
        </div>

        {result && (
          <div style={{ background: c.successBg, borderRadius: radius.md, padding: '10px 14px', font: f(600, 13), color: c.successFg }}>
            ✓ ສ້າງ {result.created} ລາຍການ · ຂ້າມ {result.skipped} (ມີຢູ່ແລ້ວ)
          </div>
        )}
        {error instanceof Error && (
          <div style={{ font: f(500, 12), color: c.dangerFg }}>{error.message}</div>
        )}
      </div>
    </Modal>
  );
}
