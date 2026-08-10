import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Paged, SettingsResponse, EditableSettings, AdminRow, AuditRow } from '../lib/types';
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

const ADMIN_ROLE_LABEL: Record<string, string> = {
  super_admin: 'ຜູ້ດູແລສູງສຸດ',
  finance: 'ຝ່າຍການເງິນ',
  staff: 'ພະນັກງານ',
};

interface NewAdmin {
  email: string;
  fullName: string;
  password: string;
  adminRole: string;
}

/**
 * One page's worth of settings.
 *
 * `PATCH /admin/settings` takes every field as optional, so a page sends only
 * the keys it owns. That is what lets these live as separate screens at all:
 * saving the commission rates cannot quietly rewrite the contact phone number
 * someone else is editing in another tab.
 */
function useSettingsSlice<T extends object>(pick: (s: SettingsResponse) => T) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsResponse>('/admin/settings'),
  });

  const server = query.data ? pick(query.data) : null;
  const serverJson = server ? JSON.stringify(server) : null;
  const [draft, setDraft] = useState<T | null>(null);

  // Re-seeds whenever the server's own values change — on first load, and again
  // after a save returns the stored figures.
  useEffect(() => {
    if (serverJson) setDraft(JSON.parse(serverJson) as T);
  }, [serverJson]);

  const save = useMutation({
    mutationFn: (patch: T) => api.patch<SettingsResponse>('/admin/settings', patch),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  return {
    query,
    draft,
    setDraft,
    save,
    dirty: !!draft && !!serverJson && JSON.stringify(draft) !== serverJson,
    revert: () => serverJson && setDraft(JSON.parse(serverJson) as T),
  };
}

/** The save / cancel row every editable settings page ends with. */
function SaveRow({
  dirty,
  saving,
  saved,
  error,
  canEdit,
  onSave,
  onRevert,
}: {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  error: unknown;
  canEdit: boolean;
  onSave: () => void;
  onRevert: () => void;
}) {
  if (!canEdit) {
    return (
      <div style={{ marginTop: 18, font: f(400, 12), color: c.muted }}>
        ຕ້ອງມີສິດ finance ຫຼື super_admin ຈຶ່ງແກ້ໄຂໄດ້
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
        marginTop: 20,
      }}
    >
      <Button disabled={!dirty || saving} onClick={onSave}>
        {saving ? 'ກຳລັງບັນທຶກ...' : 'ບັນທຶກການປ່ຽນແປງ'}
      </Button>
      {dirty && (
        <Button variant="ghost" onClick={onRevert}>
          ຍົກເລີກ
        </Button>
      )}
      {saved && !dirty && <span style={{ font: f(600, 12), color: c.successFg }}>✓ ບັນທຶກແລ້ວ</span>}
      {error instanceof Error && (
        <span style={{ font: f(500, 12), color: c.dangerFg }}>{error.message}</span>
      )}
    </div>
  );
}

// ── ຂໍ້ມູນລະບົບ ───────────────────────────────────────────────────────────────

type PlatformSlice = { app: Record<string, string> };

export function SettingsPlatform() {
  const { can } = useAuth();
  const canEdit = can('super_admin', 'finance');
  const s = useSettingsSlice<PlatformSlice>((r) => ({ app: { ...r.app } }));

  if (s.query.isError) {
    return <ErrorState error={s.query.error} onRetry={() => void s.query.refetch()} />;
  }

  const set = (key: string, value: string) =>
    s.draft && s.setDraft({ app: { ...s.draft.app, [key]: value } });

  return (
    <>
      <Card padding={24}>
        <CardTitle>ຂໍ້ມູນລະບົບ</CardTitle>
        <div className="adm-pair">
          <Field label="ຊື່ແພລດຟອມ">
            <input
              value={s.draft?.app.platform_name ?? ''}
              disabled={!canEdit || !s.draft}
              onChange={(e) => set('platform_name', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="ອີເມວຕິດຕໍ່">
            <input
              type="email"
              value={s.draft?.app.contact_email ?? ''}
              disabled={!canEdit || !s.draft}
              onChange={(e) => set('contact_email', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="ເບີໂທຕິດຕໍ່">
            <input
              value={s.draft?.app.contact_phone ?? ''}
              disabled={!canEdit || !s.draft}
              onChange={(e) => set('contact_phone', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="ຜູ້ໃຫ້ບໍລິການຊຳລະ" hint="ຕັ້ງຢູ່ .env — ບໍ່ແກ້ຈາກທີ່ນີ້">
            <input
              value={s.query.data?.system.payment_provider ?? ''}
              disabled
              style={inputStyle}
            />
          </Field>
        </div>

        <SaveRow
          dirty={s.dirty}
          saving={s.save.isPending}
          saved={s.save.isSuccess}
          error={s.save.error}
          canEdit={canEdit}
          onSave={() => s.draft && s.save.mutate(s.draft)}
          onRevert={s.revert}
        />
      </Card>
    </>
  );
}

// ── ຄ່າຄອມມິຊຊັນ & ການເງິນ ───────────────────────────────────────────────────

type FeeSlice = Pick<
  EditableSettings,
  'commission_rate_app' | 'commission_rate_walkin' | 'service_fee_rate' | 'tax_rate'
>;

export function SettingsFees() {
  const { can } = useAuth();
  const canEdit = can('super_admin', 'finance');
  const s = useSettingsSlice<FeeSlice>((r) => ({
    commission_rate_app: r.system.commission_rate_app,
    commission_rate_walkin: r.system.commission_rate_walkin,
    service_fee_rate: r.system.service_fee_rate,
    tax_rate: r.system.tax_rate,
  }));

  if (s.query.isError) {
    return <ErrorState error={s.query.error} onRetry={() => void s.query.refetch()} />;
  }

  const set = (patch: Partial<FeeSlice>) => s.draft && s.setDraft({ ...s.draft, ...patch });

  return (
    <>
      <Card padding={24}>
        <CardTitle>ຄ່າຄອມມິຊຊັນ &amp; ການເງິນ</CardTitle>

        <RateRow
          title="ອັດຕາຄ່າຄອມມິຊຊັນ (App)"
          hint="ຫັກຈາກແຕ່ລະການຈອງຜ່ານແອັບ"
          value={s.draft?.commission_rate_app}
          disabled={!canEdit || !s.draft}
          onChange={(v) => set({ commission_rate_app: v })}
        />
        <RateRow
          title="ອັດຕາຄ່າຄອມມິຊຊັນ (Walk-in)"
          hint="ຫັກຈາກການຈອງທີ່ Partner ບັນທຶກເອງ"
          value={s.draft?.commission_rate_walkin}
          disabled={!canEdit || !s.draft}
          onChange={(v) => set({ commission_rate_walkin: v })}
        />
        <RateRow
          title="ຄ່າບໍລິການ (ລູກຄ້າຈ່າຍ)"
          hint="ບວກເທິງຄ່າຫ້ອງ ໃນການຈອງຜ່ານແອັບ — walk-in ບໍ່ເກັບ"
          value={s.draft?.service_fee_rate}
          disabled={!canEdit || !s.draft}
          onChange={(v) => set({ service_fee_rate: v })}
        />
        <RateRow
          title="ພາສີ"
          hint="ບວກເທິງຄ່າຫ້ອງ + ຄ່າບໍລິການ"
          value={s.draft?.tax_rate}
          disabled={!canEdit || !s.draft}
          onChange={(v) => set({ tax_rate: v })}
          last
        />

        {/* Cancellation is no longer one platform-wide rate: each property picks
            a `cancellation_policies` row, and the penalty comes from there. */}
        <div style={{ marginTop: 16, font: f(400, 12, 19), color: c.muted }}>
          ຄ່າທຳນຽມຍົກເລີກຕັ້ງແຍກຕາມນະໂຍບາຍຂອງແຕ່ລະທີ່ພັກ (cancellation_policies) ບໍ່ແມ່ນອັດຕາລວມອີກຕໍ່ໄປ.
        </div>

        <SaveRow
          dirty={s.dirty}
          saving={s.save.isPending}
          saved={s.save.isSuccess}
          error={s.save.error}
          canEdit={canEdit}
          onSave={() => s.draft && s.save.mutate(s.draft)}
          onRevert={s.revert}
        />
      </Card>
    </>
  );
}

// ── ການດຳເນີນງານ ─────────────────────────────────────────────────────────────

type OpsSlice = Pick<
  EditableSettings,
  | 'hold_ttl_minutes'
  | 'qr_ttl_minutes'
  | 'payout_period_days'
  | 'max_nights_per_booking'
  | 'login_max_attempts'
  | 'login_lockout_minutes'
>;

export function SettingsOperations() {
  const { can } = useAuth();
  const canEdit = can('super_admin', 'finance');
  const s = useSettingsSlice<OpsSlice>((r) => ({
    hold_ttl_minutes: r.system.hold_ttl_minutes,
    qr_ttl_minutes: r.system.qr_ttl_minutes,
    payout_period_days: r.system.payout_period_days,
    max_nights_per_booking: r.system.max_nights_per_booking,
    login_max_attempts: r.system.login_max_attempts,
    login_lockout_minutes: r.system.login_lockout_minutes,
  }));

  if (s.query.isError) {
    return <ErrorState error={s.query.error} onRetry={() => void s.query.refetch()} />;
  }

  const set = (patch: Partial<OpsSlice>) => s.draft && s.setDraft({ ...s.draft, ...patch });

  return (
    <>
      <Card padding={24}>
        <CardTitle>ການດຳເນີນງານ</CardTitle>

        <CountRow
          title="ເວລາຈອງຫ້ອງໄວ້ຊົ່ວຄາວ"
          hint="ຫຼັງກົດຈອງແລ້ວ ຫ້ອງຖືກກັນໄວ້ດົນປານໃດກ່ອນຄືນສູ່ລະບົບ"
          unit="ນາທີ"
          value={s.draft?.hold_ttl_minutes}
          disabled={!canEdit || !s.draft}
          onChange={(v) => set({ hold_ttl_minutes: v })}
        />
        <CountRow
          title="ອາຍຸ QR ຊຳລະ"
          unit="ນາທີ"
          value={s.draft?.qr_ttl_minutes}
          disabled={!canEdit || !s.draft}
          onChange={(v) => set({ qr_ttl_minutes: v })}
        />
        <CountRow
          title="ຮອບໂອນເງິນ"
          hint="ຄວາມຍາວຂອງແຕ່ລະຮອບທີ່ ‘ສ້າງຮອບໃໝ່’ ຈະສ້າງ"
          unit="ວັນ"
          value={s.draft?.payout_period_days}
          disabled={!canEdit || !s.draft}
          onChange={(v) => set({ payout_period_days: v })}
        />
        <CountRow
          title="ຈຳນວນຄືນສູງສຸດຕໍ່ການຈອງ"
          unit="ຄືນ"
          value={s.draft?.max_nights_per_booking}
          disabled={!canEdit || !s.draft}
          onChange={(v) => set({ max_nights_per_booking: v })}
        />
        <CountRow
          title="ລັອກອິນຜິດໄດ້ສູງສຸດ"
          hint="ຜິດຄົບຈຳນວນນີ້ ບັນຊີຈະຖືກລັອກຊົ່ວຄາວ"
          unit="ຄັ້ງ"
          value={s.draft?.login_max_attempts}
          disabled={!canEdit || !s.draft}
          onChange={(v) => set({ login_max_attempts: v })}
        />
        <CountRow
          title="ໄລຍະລັອກບັນຊີ"
          unit="ນາທີ"
          value={s.draft?.login_lockout_minutes}
          disabled={!canEdit || !s.draft}
          onChange={(v) => set({ login_lockout_minutes: v })}
          last
        />

        <SaveRow
          dirty={s.dirty}
          saving={s.save.isPending}
          saved={s.save.isSuccess}
          error={s.save.error}
          canEdit={canEdit}
          onSave={() => s.draft && s.save.mutate(s.draft)}
          onRevert={s.revert}
        />
      </Card>
    </>
  );
}

// ── ຜູ້ດູແລລະບົບ ──────────────────────────────────────────────────────────────

export function SettingsAdmins() {
  const { admin, can } = useAuth();
  const qc = useQueryClient();
  const isSuper = can('super_admin');
  const [creating, setCreating] = useState(false);

  const admins = useQuery({
    queryKey: ['settings', 'admins'],
    queryFn: () => api.get<AdminRow[]>('/admin/admins'),
    enabled: isSuper,
  });

  const createAdmin = useMutation({
    mutationFn: (body: NewAdmin) => api.post('/admin/admins', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'admins'] });
      setCreating(false);
    },
  });

  const removeAdmin = useMutation({
    mutationFn: (id: string) => api.del(`/admin/admins/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings', 'admins'] }),
  });

  if (admins.isError) {
    return <ErrorState error={admins.error} onRetry={() => void admins.refetch()} />;
  }

  return (
    <>
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

        {!isSuper && (
          <div style={{ font: f(400, 12), color: c.muted }}>
            ສະເພາະ super_admin ຈຶ່ງເບິ່ງ ແລະ ຈັດການລາຍຊື່ຜູ້ດູແລໄດ້
          </div>
        )}

        {admins.data?.map((a, i) => (
          <div
            key={a.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              padding: '14px 0',
              borderBottom: i === admins.data!.length - 1 ? 'none' : `1px solid ${c.divider}`,
            }}
          >
            <Avatar gradient={avatarFor(a.email)} label={initials(a.fullName ?? a.email)} />
            <div style={{ flex: 1, minWidth: 140 }}>
              <div style={{ font: f(700, 13), color: c.text }}>
                {a.fullName ?? a.email}
                {a.id === admin?.id && (
                  <span style={{ font: f(400, 11), color: c.faint, marginLeft: 8 }}>(ທ່ານ)</span>
                )}
              </div>
              <div style={{ font: f(400, 11), color: c.muted }}>
                {a.email}
                {a.lastLoginAt && ` · ເຂົ້າລ່າສຸດ ${laoAgo(a.lastLoginAt)}`}
              </div>
            </div>
            <Pill
              bg={a.adminRole === 'super_admin' ? c.accentSoft : c.successBg}
              fg={a.adminRole === 'super_admin' ? c.accentDark : c.successFg}
            >
              {a.adminRole ? ADMIN_ROLE_LABEL[a.adminRole] ?? a.adminRole : '—'}
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

      {creating && (
        <CreateAdminDialog
          busy={createAdmin.isPending}
          error={createAdmin.error}
          onClose={() => setCreating(false)}
          onSubmit={(v) => createAdmin.mutate(v)}
        />
      )}
    </>
  );
}

// ── Audit log ────────────────────────────────────────────────────────────────

export function SettingsAudit() {
  const audit = useQuery({
    queryKey: ['settings', 'audit'],
    queryFn: () => api.get<Paged<AuditRow>>('/admin/audit-logs?limit=30'),
  });

  if (audit.isError) {
    return <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />;
  }

  return (
    <>
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
                    whiteSpace: 'nowrap',
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
                  <div style={{ color: c.text, fontWeight: 500 }}>{r.actor}</div>
                  <div style={{ font: f(400, 11), color: c.faint }}>{r.module ?? '—'}</div>
                </>
              ),
            },
            {
              key: 'target',
              header: 'ເປົ້າໝາຍ',
              render: (r) => (r.table ? `${r.table}${r.recordId ? ` #${r.recordId}` : ''}` : '—'),
            },
            { key: 'ip', header: 'IP', render: (r) => r.ip ?? '—' },
            {
              key: 'when',
              header: 'ເວລາ',
              align: 'right',
              render: (r) => (
                <>
                  <div>{laoAgo(r.createdAt)}</div>
                  <div style={{ font: f(400, 10), color: c.faint }}>{laoDateTime(r.createdAt)}</div>
                </>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────

/** A labelled numeric setting with its unit. */
function SettingRow({
  title,
  hint,
  unit,
  step,
  max,
  value,
  disabled,
  onChange,
  last,
}: {
  title: string;
  hint?: string;
  unit: string;
  step: string;
  max?: number;
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
        gap: 16,
        padding: '16px 0',
        borderBottom: last ? 'none' : `1px solid ${c.divider}`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ font: f(600, 14), color: c.text }}>{title}</div>
        {hint && <div style={{ font: f(400, 12, 18), color: c.muted }}>{hint}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        <input
          type="number"
          step={step}
          min={0}
          max={max}
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
        <span style={{ font: f(700, 13), color: c.soft, minWidth: 34 }}>{unit}</span>
      </div>
    </div>
  );
}

function RateRow(props: Omit<Parameters<typeof SettingRow>[0], 'unit' | 'step' | 'max'>) {
  return <SettingRow {...props} unit="%" step="0.5" max={100} />;
}

function CountRow(props: Omit<Parameters<typeof SettingRow>[0], 'step'>) {
  return <SettingRow {...props} step="1" />;
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
  onSubmit: (v: NewAdmin) => void;
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
            onClick={() =>
              onSubmit({
                email: email.trim(),
                fullName: name.trim(),
                password,
                adminRole: role,
              })
            }
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
