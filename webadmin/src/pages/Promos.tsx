import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PromoRow } from '../lib/types';
import { c, f } from '../theme';
import { kip, laoDate } from '../lib/format';
import {
  Card,
  DataTable,
  Pill,
  ErrorState,
  Button,
  Modal,
  Field,
  inputStyle,
} from '../components/ui';

export function Promos() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<PromoRow | null>(null);

  const list = useQuery({
    queryKey: ['promos'],
    queryFn: () => api.get<{ items: PromoRow[]; total: number }>('/admin/promos'),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['promos'] });

  const create = useMutation({
    mutationFn: (body: { code: string; type: string; value: number; expiresAt: string }) =>
      api.post('/admin/promos', body),
    onSuccess: () => {
      invalidate();
      setCreating(false);
    },
  });

  const toggle = useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) =>
      api.patch(`/admin/promos/${vars.id}`, { isActive: vars.isActive }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api.del<{ deleted: boolean; deactivated: boolean; reason?: string }>(`/admin/promos/${id}`),
    onSuccess: () => {
      invalidate();
      setDeleting(null);
    },
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}>
        <Button onClick={() => setCreating(true)}>+ ສ້າງໂຄ້ດໃໝ່</Button>
      </div>

      <Card padding={0}>
        <DataTable
          loading={list.isLoading}
          rows={list.data?.items ?? []}
          keyOf={(r) => r.id}
          empty="ຍັງບໍ່ມີໂຄ້ດສ່ວນຫຼຸດ"
          columns={[
            {
              key: 'code',
              header: 'ໂຄ້ດ',
              render: (r) => (
                <span
                  style={{
                    font: f(800, 13),
                    color: c.text,
                    letterSpacing: 0.5,
                    background: c.bg,
                    border: `1px dashed ${c.border}`,
                    padding: '5px 11px',
                    borderRadius: 7,
                    display: 'inline-block',
                  }}
                >
                  {r.code}
                </span>
              ),
            },
            {
              key: 'value',
              header: 'ສ່ວນຫຼຸດ',
              render: (r) => (
                <b style={{ color: c.accent, font: f(700, 14) }}>
                  {r.type === 'percent' ? `${r.value}%` : kip(r.value)}
                </b>
              ),
            },
            { key: 'used', header: 'ໃຊ້ໄປແລ້ວ', align: 'right', render: (r) => r.usedCount.toLocaleString('en-US') },
            {
              key: 'bookings',
              header: 'ຈອງຜ່ານໂຄ້ດ',
              align: 'right',
              render: (r) => r.bookingCount,
            },
            { key: 'expires', header: 'ໝົດອາຍຸ', render: (r) => laoDate(r.expiresAt) },
            {
              key: 'status',
              header: 'ສະຖານະ',
              render: (r) =>
                r.isExpired ? (
                  <Pill bg={c.neutralBg} fg={c.neutralFg}>ໝົດອາຍຸ</Pill>
                ) : r.isActive ? (
                  <Pill bg={c.successBg} fg={c.successFg}>ໃຊ້ງານ</Pill>
                ) : (
                  <Pill bg={c.warnBg} fg={c.warnFg}>ປິດຢູ່</Pill>
                ),
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (r) => (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  {!r.isExpired && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate({ id: r.id, isActive: !r.isActive })}
                    >
                      {r.isActive ? 'ປິດ' : 'ເປີດ'}
                    </Button>
                  )}
                  <Button size="sm" variant="danger" onClick={() => setDeleting(r)}>
                    ລຶບ
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {creating && (
        <CreatePromoDialog
          busy={create.isPending}
          error={create.error}
          onClose={() => setCreating(false)}
          onSubmit={(v) => create.mutate(v)}
        />
      )}

      {deleting && (
        <Modal
          title={`ລຶບໂຄ້ດ ${deleting.code}`}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)} disabled={remove.isPending}>
                ຍົກເລີກ
              </Button>
              <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(deleting.id)}>
                {remove.isPending ? 'ກຳລັງລຶບ...' : 'ຢືນຢັນ'}
              </Button>
            </>
          }
        >
          <div style={{ font: f(400, 13, 21), color: c.soft }}>
            {deleting.bookingCount > 0 ? (
              <>
                ໂຄ້ດນີ້ຖືກໃຊ້ໃນ <b>{deleting.bookingCount}</b> ການຈອງແລ້ວ ຈຶ່ງລຶບບໍ່ໄດ້ —
                ລະບົບຈະ <b>ປິດການໃຊ້ງານ</b> ແທນ ເພື່ອຮັກສາປະຫວັດການຈອງໄວ້.
              </>
            ) : (
              <>ໂຄ້ດນີ້ຍັງບໍ່ເຄີຍຖືກໃຊ້ ຈຶ່ງຈະຖືກລຶບອອກຖາວອນ.</>
            )}
          </div>
          {remove.error instanceof Error && (
            <div style={{ marginTop: 14, font: f(500, 12), color: c.dangerFg }}>
              {remove.error.message}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function CreatePromoDialog({
  busy,
  error,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (v: { code: string; type: string; value: number; expiresAt: string }) => void;
}) {
  const [code, setCode] = useState('');
  const [type, setType] = useState('percent');
  const [value, setValue] = useState('10');
  const [expiresAt, setExpiresAt] = useState(defaultExpiry());

  const valid = code.trim().length > 0 && Number(value) > 0 && !!expiresAt;

  return (
    <Modal
      title="ສ້າງໂຄ້ດສ່ວນຫຼຸດໃໝ່"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            ຍົກເລີກ
          </Button>
          <Button
            disabled={busy || !valid}
            onClick={() =>
              onSubmit({ code: code.trim().toUpperCase(), type, value: Number(value), expiresAt })
            }
          >
            {busy ? 'ກຳລັງສ້າງ...' : 'ສ້າງໂຄ້ດ'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="ໂຄ້ດ" hint="ໃຊ້ໄດ້ສະເພາະ A–Z, 0–9, - ແລະ _">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="BOUN2026"
            style={inputStyle}
          />
        </Field>

        <Field label="ປະເພດ">
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { v: 'percent', l: 'ເປີເຊັນ (%)' },
              { v: 'fixed', l: 'ຈຳນວນຄົງທີ່ (₭)' },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => setType(o.v)}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 11,
                  font: f(600, 13),
                  cursor: 'pointer',
                  background: type === o.v ? c.accentSoft : '#fff',
                  border: `1px solid ${type === o.v ? c.accent : c.border}`,
                  color: type === o.v ? c.accentDark : c.muted,
                }}
              >
                {o.l}
              </button>
            ))}
          </div>
        </Field>

        <Field label={type === 'percent' ? 'ສ່ວນຫຼຸດ (%)' : 'ສ່ວນຫຼຸດ (ກີບ)'}>
          <input
            type="number"
            min={1}
            max={type === 'percent' ? 100 : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={inputStyle}
          />
        </Field>

        <Field label="ວັນໝົດອາຍຸ">
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
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

function defaultExpiry(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}
