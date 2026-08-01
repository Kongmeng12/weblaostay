import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PlatformSettings, AdminRow, AuditRow } from '../lib/types';
import { c, f, radius, avatarFor } from '../theme';
import { laoDateTime, laoAgo, initials } from '../lib/format';
import {
  Card,
  CardTitle,
  Button,
  Field,
  inputStyle,
  ErrorState,
  Avatar,
  Modal,
  Pill,
  DataTable,
} from '../components/ui';
import { useAuth } from '../auth/AuthContext';

export function Settings() {
  const { admin, can } = useAuth();
  const qc = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<PlatformSettings>('/admin/settings'),
  });
  const admins = useQuery({
    queryKey: ['settings', 'admins'],
    queryFn: () => api.get<AdminRow[]>('/admin/settings/admins'),
  });
  const audit = useQuery({
    queryKey: ['settings', 'audit'],
    queryFn: () =>
      api.get<{ items: AuditRow[]; total: number }>('/admin/settings/audit-logs?limit=15'),
  });

  const [form, setForm] = useState<PlatformSettings | null>(null);
  const [creating, setCreating] = useState(false);

  // Seed the form once the server values arrive, without clobbering edits.
  useEffect(() => {
    if (settings.data && !form) setForm(settings.data);
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: (body: PlatformSettings) => api.put<PlatformSettings>('/admin/settings', body),
    onSuccess: (data) => {
      setForm(data);
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const createAdmin = useMutation({
    mutationFn: (body: { email: string; name: string; password: string; role: string }) =>
      api.post('/admin/settings/admins', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'admins'] });
      setCreating(false);
    },
  });

  const removeAdmin = useMutation({
    mutationFn: (id: string) => api.del(`/admin/settings/admins/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings', 'admins'] }),
  });

  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }

  const canEditMoney = can('super_admin', 'finance');
  const isSuper = can('super_admin');
  const dirty = !!form && !!settings.data && JSON.stringify(form) !== JSON.stringify(settings.data);

  return (
    <div style={{ maxWidth: 860, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* platform */}
      <Card padding={24}>
        <CardTitle>ຂໍ້ມູນລະບົບ</CardTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="ຊື່ແພລດຟອມ">
            <input
              value={form?.platform_name ?? ''}
              disabled={!canEditMoney}
              onChange={(e) => form && setForm({ ...form, platform_name: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="ອີເມວຕິດຕໍ່">
            <input
              type="email"
              value={form?.contact_email ?? ''}
              disabled={!canEditMoney}
              onChange={(e) => form && setForm({ ...form, contact_email: e.target.value })}
              style={inputStyle}
            />
          </Field>
        </div>
      </Card>

      {/* money */}
      <Card padding={24}>
        <CardTitle>ຄ່າຄອມມິຊຊັນ &amp; ການເງິນ</CardTitle>

        <RateRow
          title="ອັດຕາຄ່າຄອມມິຊຊັນ (App)"
          hint="ຫັກຈາກແຕ່ລະການຈອງຜ່ານແອັບ"
          value={form?.commission_rate}
          disabled={!canEditMoney}
          onChange={(v) => form && setForm({ ...form, commission_rate: v })}
        />
        <RateRow
          title="ອັດຕາຄ່າຄອມມິຊຊັນ (Walk-in)"
          hint="ຫັກຈາກການຈອງທີ່ Partner ບັນທຶກເອງ"
          value={form?.walkin_commission_rate}
          disabled={!canEditMoney}
          onChange={(v) => form && setForm({ ...form, walkin_commission_rate: v })}
        />
        <RateRow
          title="ຄ່າທຳນຽມຍົກເລີກ"
          hint="ຫັກເມື່ອລູກຄ້າຍົກເລີກ — ສ່ວນທີ່ເຫຼືອຄືນໃຫ້ລູກຄ້າ"
          value={form?.cancellation_fee_rate}
          disabled={!canEditMoney}
          onChange={(v) => form && setForm({ ...form, cancellation_fee_rate: v })}
        />
        <RateRow
          title="ຄ່າບໍລິການ (ລູກຄ້າຈ່າຍ)"
          hint="ບວກເທິງຄ່າຫ້ອງ ໃນການຈອງຜ່ານແອັບ — walk-in ບໍ່ເກັບ"
          value={form?.service_fee_rate}
          disabled={!canEditMoney}
          onChange={(v) => form && setForm({ ...form, service_fee_rate: v })}
          last
        />

        {canEditMoney ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 20 }}>
            <Button
              disabled={!dirty || save.isPending}
              onClick={() => form && save.mutate(form)}
            >
              {save.isPending ? 'ກຳລັງບັນທຶກ...' : 'ບັນທຶກການປ່ຽນແປງ'}
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setForm(settings.data ?? null)}>
                ຍົກເລີກ
              </Button>
            )}
            {save.isSuccess && !dirty && (
              <span style={{ font: f(600, 12), color: c.successFg }}>✓ ບັນທຶກແລ້ວ</span>
            )}
            {save.error instanceof Error && (
              <span style={{ font: f(500, 12), color: c.dangerFg }}>{save.error.message}</span>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 16, font: f(400, 12), color: c.muted }}>
            ຕ້ອງມີສິດ finance ຫຼື super_admin ຈຶ່ງແກ້ໄຂໄດ້
          </div>
        )}
      </Card>

      {/* admins */}
      <Card padding={24}>
        <CardTitle
          right={
            isSuper ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                + ເພີ່ມຜູ້ດູແລ
              </Button>
            ) : undefined
          }
        >
          ຜູ້ດູແລລະບົບ
        </CardTitle>

        {admins.data?.map((a, i) => (
          <div
            key={a.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 0',
              borderBottom: i === admins.data!.length - 1 ? 'none' : `1px solid ${c.divider}`,
            }}
          >
            <Avatar gradient={avatarFor(a.email)} label={initials(a.name)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: f(700, 13), color: c.text }}>
                {a.name}
                {a.id === admin?.id && (
                  <span style={{ font: f(400, 11), color: c.faint, marginLeft: 8 }}>(ທ່ານ)</span>
                )}
              </div>
              <div style={{ font: f(400, 11), color: c.muted }}>
                {a.email}
                {a.last_login_at && ` · ເຂົ້າລ່າສຸດ ${laoAgo(a.last_login_at)}`}
              </div>
            </div>
            <Pill
              bg={a.role === 'super_admin' ? c.accentSoft : c.successBg}
              fg={a.role === 'super_admin' ? c.accentDark : c.successFg}
            >
              {a.roleLabel}
            </Pill>
            {isSuper && a.id !== admin?.id && (
              <Button
                size="sm"
                variant="danger"
                disabled={removeAdmin.isPending}
                onClick={() => removeAdmin.mutate(a.id)}
              >
                ລຶບ
              </Button>
            )}
          </div>
        ))}

        {removeAdmin.error instanceof Error && (
          <div style={{ marginTop: 12, font: f(500, 12), color: c.dangerFg }}>
            {removeAdmin.error.message}
          </div>
        )}
      </Card>

      {/* audit log */}
      <Card padding={0}>
        <div
          style={{
            padding: '18px 22px',
            borderBottom: `1px solid ${c.divider}`,
            font: f(700, 16),
            color: c.text,
          }}
        >
          ບັນທຶກການກະທຳ · Audit log
          <div style={{ font: f(400, 12), color: c.muted, marginTop: 2 }}>
            ທຸກການກະທຳສຳຄັນຖືກບັນທຶກພ້ອມ IP ຜູ້ກະທຳ
          </div>
        </div>
        <DataTable
          loading={audit.isLoading}
          rows={audit.data?.items ?? []}
          keyOf={(r) => r.id}
          empty="ຍັງບໍ່ມີບັນທຶກ"
          columns={[
            {
              key: 'action',
              header: 'ການກະທຳ',
              render: (r) => (
                <span
                  style={{
                    font: f(700, 12),
                    color: c.text,
                    background: c.bg,
                    padding: '4px 9px',
                    borderRadius: 6,
                  }}
                >
                  {r.action}
                </span>
              ),
            },
            {
              key: 'actor',
              header: 'ຜູ້ກະທຳ',
              render: (r) => (
                <>
                  <div style={{ color: c.text, fontWeight: 500 }}>{r.actorName}</div>
                  <div style={{ font: f(400, 11), color: c.faint }}>{r.actorEmail ?? r.actor_type}</div>
                </>
              ),
            },
            { key: 'target', header: 'ເປົ້າໝາຍ', render: (r) => r.target ?? '—' },
            { key: 'ip', header: 'IP', render: (r) => r.ip_address ?? '—' },
            {
              key: 'when',
              header: 'ເວລາ',
              align: 'right',
              render: (r) => (
                <>
                  <div>{laoAgo(r.created_at)}</div>
                  <div style={{ font: f(400, 10), color: c.faint }}>{laoDateTime(r.created_at)}</div>
                </>
              ),
            },
          ]}
        />
      </Card>

      {creating && (
        <CreateAdminDialog
          busy={createAdmin.isPending}
          error={createAdmin.error}
          onClose={() => setCreating(false)}
          onSubmit={(v) => createAdmin.mutate(v)}
        />
      )}
    </div>
  );
}

function RateRow({
  title,
  hint,
  value,
  disabled,
  onChange,
  last,
}: {
  title: string;
  hint: string;
  value: number | undefined;
  disabled: boolean;
  onChange: (v: number) => void;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 0',
        borderBottom: last ? 'none' : `1px solid ${c.divider}`,
      }}
    >
      <div>
        <div style={{ font: f(600, 14), color: c.text }}>{title}</div>
        <div style={{ font: f(400, 12), color: c.muted }}>{hint}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="number"
          step="0.5"
          min={0}
          max={100}
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: 74,
            padding: 10,
            background: c.bg,
            border: `1px solid ${c.border}`,
            borderRadius: radius.sm,
            font: f(700, 15),
            color: c.text,
            textAlign: 'center',
            outline: 'none',
          }}
        />
        <span style={{ font: f(700, 15), color: c.soft }}>%</span>
      </div>
    </div>
  );
}

function CreateAdminDialog({
  busy,
  error,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (v: { email: string; name: string; password: string; role: string }) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('staff');

  const valid = email.includes('@') && name.trim().length >= 2 && password.length >= 8;

  return (
    <Modal
      title="ເພີ່ມຜູ້ດູແລລະບົບ"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            ຍົກເລີກ
          </Button>
          <Button
            disabled={busy || !valid}
            onClick={() => onSubmit({ email: email.trim(), name: name.trim(), password, role })}
          >
            {busy ? 'ກຳລັງສ້າງ...' : 'ສ້າງບັນຊີ'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="ຊື່ ແລະ ນາມສະກຸນ">
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="ອີເມວ">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@laostay.la"
            style={inputStyle}
          />
        </Field>
        <Field label="ລະຫັດຜ່ານ" hint="ຢ່າງໜ້ອຍ 8 ຕົວອັກສອນ">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="ສິດ">
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { v: 'staff', l: 'Staff' },
              { v: 'finance', l: 'Finance' },
              { v: 'super_admin', l: 'Super Admin' },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => setRole(o.v)}
                style={{
                  flex: 1,
                  padding: 11,
                  borderRadius: 10,
                  font: f(600, 12),
                  cursor: 'pointer',
                  background: role === o.v ? c.accentSoft : '#fff',
                  border: `1px solid ${role === o.v ? c.accent : c.border}`,
                  color: role === o.v ? c.accentDark : c.muted,
                }}
              >
                {o.l}
              </button>
            ))}
          </div>
        </Field>
        {error instanceof Error && (
          <div style={{ font: f(500, 12), color: c.dangerFg }}>{error.message}</div>
        )}
      </div>
    </Modal>
  );
}
