import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ApprovalRow } from '../lib/types';
import { c, f, radius, avatarFor } from '../theme';
import { laoDate, laoAgo } from '../lib/format';
import { Card, ErrorState, Button, Avatar, EmptyState, Modal, inputStyle, Field } from '../components/ui';

const TYPE_LABEL: Record<string, string> = {
  homestay: 'ໂຮມສະເຕ',
  villa: 'ວິນລ່າ',
  resort: 'ຣີສອດ',
  guesthouse: 'ເຮືອນພັກ',
};

const BUSINESS_TYPE_LABEL: Record<string, string> = {
  individual: 'ບຸກຄົນທົ່ວໄປ',
  company: 'ບໍລິສັດ',
  partnership: 'ຫ້າງຫຸ້ນສ່ວນ',
};

const DOC_LABEL: Record<string, string> = {
  id_card: 'ບັດປະຈຳຕົວ',
  business_license: 'ໃບທະບຽນວິສາຫະກິດ',
  bank_book: 'ປຶ້ມບັນຊີທະນາຄານ',
};

export function Approvals() {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<ApprovalRow | null>(null);
  const [viewing, setViewing] = useState<ApprovalRow | null>(null);

  const list = useQuery({
    queryKey: ['approvals'],
    queryFn: () => api.get<ApprovalRow[]>('/admin/approvals'),
  });

  // Keyed by partner_status, and a status with no partners is simply absent —
  // so read every count through `?? 0` rather than assuming the key is there.
  const counts = useQuery({
    queryKey: ['approvals', 'counts'],
    queryFn: () => api.get<Partial<Record<string, number>>>('/admin/approvals/counts'),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['approvals'] });
    void qc.invalidateQueries({ queryKey: ['partners'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/approvals/${id}/approve`),
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: (vars: { id: string; reason: string }) =>
      api.patch(`/admin/approvals/${vars.id}/reject`, { reason: vars.reason }),
    onSuccess: () => {
      invalidate();
      setRejecting(null);
    },
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const rows = list.data ?? [];

  return (
    <div>
      <div className="adm-trio" style={{ marginBottom: 22 }}>
        <StatBox label="ລໍອະນຸມັດ" value={counts.data && (counts.data.pending ?? 0)} color={c.accent} />
        <StatBox
          label="ອະນຸມັດແລ້ວ"
          value={counts.data && (counts.data.verified ?? 0)}
          color={c.successFg}
        />
        <StatBox label="ບໍ່ຜ່ານ" value={counts.data && (counts.data.rejected ?? 0)} color={c.muted} />
      </div>

      {list.isLoading ? (
        <Card>
          <div style={{ font: f(400, 13), color: c.muted }}>ກຳລັງໂຫຼດ...</div>
        </Card>
      ) : rows.length === 0 ? (
        <Card padding={0}>
          <EmptyState
            message="ບໍ່ມີໃບສະໝັກລໍອະນຸມັດ"
            hint="ໃບສະໝັກໃໝ່ຈາກ Partner app ຈະປາກົດຢູ່ນີ້"
          />
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {rows.map((r) => (
            <Card key={r.id} padding={0}>
              <div style={{ display: 'flex', alignItems: 'stretch' }}>
                <div
                  style={{
                    width: 6,
                    background: c.warnBg,
                    borderRadius: `${radius.lg}px 0 0 ${radius.lg}px`,
                  }}
                />
                <div style={{ flex: 1, padding: 20, display: 'flex', gap: 18, alignItems: 'center' }}>
                  {/* Clicking the info area opens the detail modal */}
                  <div
                    style={{ display: 'flex', gap: 18, alignItems: 'center', flex: 1, minWidth: 0, cursor: 'pointer' }}
                    onClick={() => setViewing(r)}
                  >
                    <Avatar gradient={avatarFor(r.id)} size={54} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <span style={{ font: f(800, 16), color: c.text }}>{r.businessName}</span>
                        {r.properties.length > 1 && (
                          <span
                            style={{
                              font: f(600, 11),
                              background: c.infoBg,
                              color: c.infoFg,
                              padding: '2px 9px',
                              borderRadius: 7,
                            }}
                          >
                            {r.properties.length} ທີ່ພັກ
                          </span>
                        )}
                      </div>
                      <div style={{ font: f(400, 13), color: c.soft, marginBottom: 6 }}>
                        {r.ownerName ?? '—'} · {r.phone ?? '—'}
                      </div>

                      {r.properties.length === 0 ? (
                        <div style={{ font: f(400, 12), color: c.faint }}>ຍັງບໍ່ໄດ້ເພີ່ມທີ່ພັກ</div>
                      ) : (
                        <div style={{ display: 'grid', gap: 3 }}>
                          {r.properties.map((p) => (
                            <div key={p.id} style={{ font: f(400, 12), color: c.faint }}>
                              <span style={{ color: c.soft, fontWeight: 600 }}>{p.name}</span>
                              {' · '}
                              {TYPE_LABEL[p.type] ?? p.type}
                              {p.province ? ` · ${p.province}` : ''}
                              {p.address ? ` · ${p.address}` : ''}
                            </div>
                          ))}
                        </div>
                      )}

                      <div style={{ font: f(400, 11), color: c.faint, marginTop: 6 }}>
                        ສະໝັກເມື່ອ {laoDate(r.appliedAt)} · {laoAgo(r.appliedAt)} · {r.email}
                        {r.documents.length ? ` · ${r.documents.length} ເອກະສານ` : ' · ບໍ່ມີເອກະສານ'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, flex: 'none' }}>
                    <Button
                      variant="ghost"
                      disabled={reject.isPending || approve.isPending}
                      onClick={() => setRejecting(r)}
                    >
                      ປະຕິເສດ
                    </Button>
                    <Button
                      variant="success"
                      disabled={approve.isPending}
                      onClick={() => approve.mutate(r.id)}
                    >
                      {approve.isPending && approve.variables === r.id ? 'ກຳລັງ...' : 'ອະນຸມັດ'}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {approve.error instanceof Error && (
        <div style={{ marginTop: 14 }}>
          <ErrorState error={approve.error} />
        </div>
      )}

      {viewing && (
        <DetailModal
          row={viewing}
          onClose={() => setViewing(null)}
          onApprove={() => { approve.mutate(viewing.id); setViewing(null); }}
          onReject={() => { setRejecting(viewing); setViewing(null); }}
          approveBusy={approve.isPending}
        />
      )}

      {rejecting && (
        <RejectDialog
          row={rejecting}
          busy={reject.isPending}
          error={reject.error}
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => reject.mutate({ id: rejecting.id, reason })}
        />
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value?: number; color: string }) {
  return (
    <Card padding={18}>
      <div style={{ font: f(400, 12), color: c.muted, marginBottom: 8 }}>{label}</div>
      <div style={{ font: f(800, 28), color }}>{value ?? '—'}</div>
    </Card>
  );
}

function DetailModal({
  row,
  onClose,
  onApprove,
  onReject,
  approveBusy,
}: {
  row: ApprovalRow;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  approveBusy: boolean;
}) {
  return (
    <Modal
      title={`ລາຍລະອຽດໃບສະໝັກ — ${row.businessName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>ປິດ</Button>
          <Button variant="ghost" onClick={onReject}>ປະຕິເສດ</Button>
          <Button variant="success" disabled={approveBusy} onClick={onApprove}>
            {approveBusy ? 'ກຳລັງ...' : 'ອະນຸມັດ'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 20 }}>

        {/* ─── ຂໍ້ມູນເຈົ້າຂອງ ─── */}
        <section>
          <div style={{ font: f(700, 12), color: c.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            ຂໍ້ມູນເຈົ້າຂອງ
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
            <DetailField label="ຊື່ເຈົ້າຂອງ" value={row.ownerName} />
            <DetailField label="ອີເມວ" value={row.email} />
            <DetailField label="ເບີໂທ" value={row.phone} />
            <DetailField label="ສະໝັກເມື່ອ" value={row.appliedAt ? laoDate(row.appliedAt) : null} />
          </div>
        </section>

        <div style={{ borderTop: `1px solid ${c.border}` }} />

        {/* ─── ຂໍ້ມູນທຸລະກິດ ─── */}
        <section>
          <div style={{ font: f(700, 12), color: c.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            ຂໍ້ມູນທຸລະກິດ
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
            <DetailField label="ຊື່ທຸລະກິດ" value={row.businessName} />
            <DetailField label="ປະເພດທຸລະກິດ" value={BUSINESS_TYPE_LABEL[row.businessType] ?? row.businessType} />
            <DetailField label="ເລກທະບຽນພາສີ" value={row.taxId} />
          </div>
        </section>

        {/* ─── ທີ່ພັກ ─── */}
        {row.properties.map((p, i) => (
          <div key={p.id}>
            <div style={{ borderTop: `1px solid ${c.border}`, marginBottom: 16 }} />
            <div style={{ font: f(700, 12), color: c.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              ທີ່ພັກ{row.properties.length > 1 ? ` ${i + 1}` : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
              <DetailField label="ຊື່ທີ່ພັກ" value={p.name} />
              <DetailField label="ປະເພດ" value={TYPE_LABEL[p.type] ?? p.type} />
              <DetailField label="ເບີໂທຕິດຕໍ່" value={p.phone} />
              <DetailField label="ແຂວງ" value={p.province} />
              <DetailField label="ເມືອງ" value={p.district} />
              <DetailField label="ບ້ານ" value={p.village} />
              <div style={{ gridColumn: '1 / -1' }}>
                <DetailField label="ທີ່ຢູ່ / ລາຍລະອຽດ" value={p.address} />
              </div>
              {p.description && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <DetailField label="ລາຍລະອຽດທີ່ພັກ" value={p.description} />
                </div>
              )}
            </div>
          </div>
        ))}

        {/* ─── ເອກະສານ ─── */}
        {row.documents.length > 0 && (
          <>
            <div style={{ borderTop: `1px solid ${c.border}` }} />
            <section>
              <div style={{ font: f(700, 12), color: c.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                ເອກະສານ ({row.documents.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {row.documents.map((d) => (
                  <a
                    key={d.id}
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      font: f(600, 12),
                      color: c.infoFg,
                      background: c.infoBg,
                      padding: '6px 14px',
                      borderRadius: 8,
                      textDecoration: 'none',
                    }}
                  >
                    📄 {DOC_LABEL[d.type] ?? d.type}
                  </a>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div style={{ font: f(500, 11), color: c.muted, marginBottom: 2 }}>{label}</div>
      <div style={{ font: f(600, 13), color: value ? c.text : c.faint }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

function RejectDialog({
  row,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  row: ApprovalRow;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Modal
      title={`ປະຕິເສດ ${row.businessName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            ຍົກເລີກ
          </Button>
          <Button variant="danger" onClick={() => onConfirm(reason)} disabled={busy}>
            {busy ? 'ກຳລັງດຳເນີນການ...' : 'ຢືນຢັນປະຕິເສດ'}
          </Button>
        </>
      }
    >
      <div style={{ font: f(400, 13, 21), color: c.soft, marginBottom: 18 }}>
        Partner ຈະໄດ້ຮັບແຈ້ງເຕືອນພ້ອມເຫດຜົນ ແລະ ຈະບໍ່ສາມາດຮັບການຈອງໄດ້.
      </div>
      <Field label="ເຫດຜົນ (ຈະສົ່ງໃຫ້ Partner)">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="ເຊັ່ນ: ຮູບພາບບໍ່ຄົບ / ຂໍ້ມູນທີ່ຢູ່ບໍ່ຊັດເຈນ"
          style={inputStyle}
        />
      </Field>
      {error instanceof Error && (
        <div style={{ marginTop: 14, font: f(500, 12), color: c.dangerFg }}>{error.message}</div>
      )}
    </Modal>
  );
}
