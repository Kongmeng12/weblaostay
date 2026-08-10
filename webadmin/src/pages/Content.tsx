import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Announcement, AppPage, Audience, Banner, BannerTarget, Faq } from '../lib/types';
import { c, f, radius } from '../theme';
import { laoDate, laoDateTime } from '../lib/format';
import {
  Button,
  Card,
  CardTitle,
  Chips,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Pill,
  inputStyle,
} from '../components/ui';

type Tab = 'banners' | 'announcements' | 'faqs' | 'pages';

const TABS: { value: Tab; label: string }[] = [
  { value: 'banners', label: 'ແບນເນີ' },
  { value: 'announcements', label: 'ປະກາດ' },
  { value: 'faqs', label: 'ຄຳຖາມທີ່ພົບເລື້ອຍ' },
  { value: 'pages', label: 'ໜ້າຄົງທີ່' },
];

const AUDIENCE_LABEL: Record<Audience, string> = {
  ALL: 'ທຸກຄົນ',
  CUSTOMER: 'ລູກຄ້າ',
  PARTNER: 'Partner',
};

/**
 * Editorial content — what the apps show on their home screen and in their
 * legal pages.
 *
 * Four tables with the same shape of work (list, edit, publish), so they share
 * one page rather than four sidebar entries nobody visits.
 */
export function Content() {
  const [tab, setTab] = useState<Tab>('banners');

  return (
    <div style={{ maxWidth: 980, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Chips options={TABS} value={tab} onChange={setTab} />
      {tab === 'banners' && <BannersTab />}
      {tab === 'announcements' && <AnnouncementsTab />}
      {tab === 'faqs' && <FaqsTab />}
      {tab === 'pages' && <PagesTab />}
    </div>
  );
}

/**
 * One row's worth of live/scheduled state.
 *
 * The public endpoints filter on `is_active` *and* the date window, so a banner
 * can be active and still invisible. Saying which is which here saves an admin
 * from re-saving a banner that was never going to show.
 */
function LiveState({
  isActive,
  startDate,
  endDate,
}: {
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const notYet = startDate ? startDate.slice(0, 10) > today : false;
  const over = endDate ? endDate.slice(0, 10) < today : false;

  if (!isActive) return <Pill bg={c.neutralBg} fg={c.neutralFg}>ປິດຢູ່</Pill>;
  if (notYet) return <Pill bg={c.warnBg} fg={c.warnFg}>ລໍຖ້າ {laoDate(startDate)}</Pill>;
  if (over) return <Pill bg={c.neutralBg} fg={c.neutralFg}>ໝົດອາຍຸແລ້ວ</Pill>;
  return <Pill bg={c.successBg} fg={c.successFg}>ກຳລັງສະແດງ</Pill>;
}

/** The date window as a sentence, or nothing when there is no window. */
function windowLabel(startDate: string | null, endDate: string | null): string | null {
  if (!startDate && !endDate) return null;
  if (startDate && endDate) return `${laoDate(startDate)} – ${laoDate(endDate)}`;
  return startDate ? `ຈາກ ${laoDate(startDate)}` : `ຮອດ ${laoDate(endDate)}`;
}

/** `<input type="date">` wants `YYYY-MM-DD`; the API sends a full timestamp. */
const dateInput = (value: string | null | undefined) => (value ? value.slice(0, 10) : '');

function Row({ children, last }: { children: React.ReactNode; last: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        padding: '15px 0',
        borderBottom: last ? 'none' : `1px solid ${c.divider}`,
      }}
    >
      {children}
    </div>
  );
}

function SaveError({ error }: { error: unknown }) {
  if (!(error instanceof Error)) return null;
  return <div style={{ font: f(500, 12), color: c.dangerFg, marginTop: 12 }}>{error.message}</div>;
}

// ── banners ──────────────────────────────────────────────────────────────────

type BannerForm = Omit<Banner, 'id'> & { id?: string };

const EMPTY_BANNER: BannerForm = {
  title: '',
  description: null,
  imageUrl: null,
  targetType: null,
  targetId: null,
  order: 0,
  startDate: null,
  endDate: null,
  isActive: true,
};

function BannersTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<BannerForm | null>(null);

  const list = useQuery({
    queryKey: ['content', 'banners'],
    queryFn: () => api.get<Banner[]>('/admin/content/banners'),
  });

  const save = useMutation({
    // The write DTO is not the read shape: it spells the sort key
    // `displayOrder`, and the API rejects any key it does not declare — so the
    // form is mapped across rather than posted as-is.
    mutationFn: (body: BannerForm) =>
      api.post<Banner>('/admin/content/banners', {
        id: body.id,
        title: body.title,
        description: body.description ?? undefined,
        imageUrl: body.imageUrl ?? undefined,
        targetType: body.targetType ?? undefined,
        targetId: body.targetId ?? undefined,
        displayOrder: body.order,
        startDate: body.startDate ?? undefined,
        endDate: body.endDate ?? undefined,
        isActive: body.isActive,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['content', 'banners'] });
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/admin/content/banners/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['content', 'banners'] }),
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const rows = list.data ?? [];

  return (
    <Card padding={24}>
      <CardTitle
        right={
          <Button size="sm" onClick={() => setEditing({ ...EMPTY_BANNER, order: rows.length })}>
            + ແບນເນີໃໝ່
          </Button>
        }
      >
        ແບນເນີໜ້າຫຼັກ
      </CardTitle>

      {!rows.length && !list.isLoading && (
        <EmptyState message="ຍັງບໍ່ມີແບນເນີ" hint="ແບນເນີສະແດງເທິງສຸດຂອງໜ້າຫຼັກແອັບລູກຄ້າ" />
      )}

      {rows.map((b, i) => {
        const when = windowLabel(b.startDate, b.endDate);
        return (
          <Row key={b.id} last={i === rows.length - 1}>
            <div
              style={{
                width: 84,
                height: 52,
                flex: 'none',
                borderRadius: radius.sm,
                background: b.imageUrl ? `url(${b.imageUrl}) center/cover` : c.bg,
                border: `1px solid ${c.border}`,
                display: 'grid',
                placeItems: 'center',
                font: f(700, 16),
                color: c.faint,
              }}
            >
              {!b.imageUrl && '🖼'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: f(700, 13.5), color: c.text }}>{b.title}</div>
              {b.description && (
                <div style={{ font: f(400, 12, 18), color: c.muted, marginTop: 2 }}>
                  {b.description}
                </div>
              )}
              <div style={{ font: f(400, 11), color: c.faint, marginTop: 4 }}>
                ລຳດັບ {b.order}
                {b.targetType && ` · ໄປ ${b.targetType}${b.targetId ? ` #${b.targetId}` : ''}`}
                {when && ` · ${when}`}
              </div>
            </div>
            <LiveState isActive={b.isActive} startDate={b.startDate} endDate={b.endDate} />
            <Button
              size="sm"
              variant="ghost"
              title={`ແກ້ໄຂ ${b.title}`}
              onClick={() => setEditing({ ...b })}
            >
              ແກ້ໄຂ
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(b.id)}
            >
              ລຶບ
            </Button>
          </Row>
        );
      })}

      <SaveError error={remove.error} />

      {editing && (
        <Modal
          title={editing.id ? 'ແກ້ໄຂແບນເນີ' : 'ແບນເນີໃໝ່'}
          width={520}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={save.isPending}>
                ຍົກເລີກ
              </Button>
              <Button
                disabled={save.isPending || editing.title.trim().length < 1}
                onClick={() => save.mutate(editing)}
              >
                {save.isPending ? 'ກຳລັງບັນທຶກ...' : 'ບັນທຶກ'}
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="ຫົວຂໍ້">
              <input
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                style={inputStyle}
              />
            </Field>
            <Field label="ຄຳອະທິບາຍ">
              <textarea
                value={editing.description ?? ''}
                onChange={(e) => setEditing({ ...editing, description: e.target.value || null })}
                rows={2}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </Field>
            <Field label="ທີ່ຢູ່ຮູບ" hint="ອັບໂຫຼດຮູບຜ່ານ /uploads ແລ້ວວາງ URL ທີ່ໄດ້ໃສ່ນີ້">
              <input
                value={editing.imageUrl ?? ''}
                onChange={(e) => setEditing({ ...editing, imageUrl: e.target.value || null })}
                placeholder="/uploads/banner.jpg"
                style={inputStyle}
              />
            </Field>

            <Field
              label="ກົດແລ້ວໄປໃສ"
              hint="ປະເພດ url ຍັງໃຊ້ບໍ່ໄດ້ — ຕາຕະລາງ banners ເກັບໄດ້ແຕ່ເລກ id ບໍ່ມີບ່ອນເກັບທີ່ຢູ່ເວັບ"
            >
              <div style={{ display: 'flex', gap: 8 }}>
                {(
                  [
                    { v: null, l: 'ບໍ່ໄປໃສ' },
                    { v: 'property', l: 'ທີ່ພັກ' },
                    { v: 'promotion', l: 'ໂປຣໂມຊັນ' },
                  ] as { v: BannerTarget | null; l: string }[]
                ).map((o) => {
                  const on = editing.targetType === o.v;
                  return (
                    <button
                      key={o.l}
                      onClick={() =>
                        setEditing({
                          ...editing,
                          targetType: o.v,
                          targetId: o.v ? editing.targetId : null,
                        })
                      }
                      style={{
                        flex: 1,
                        padding: 11,
                        borderRadius: 10,
                        font: f(600, 12),
                        cursor: 'pointer',
                        background: on ? c.accentSoft : '#fff',
                        border: `1px solid ${on ? c.accent : c.border}`,
                        color: on ? c.accentDark : c.muted,
                      }}
                    >
                      {o.l}
                    </button>
                  );
                })}
              </div>
            </Field>

            {editing.targetType && (
              <Field label="ເລກ id ຂອງເປົ້າໝາຍ" hint="ບໍ່ມີຈິງໃນລະບົບ ຈະບັນທຶກບໍ່ຜ່ານ">
                <input
                  value={editing.targetId ?? ''}
                  onChange={(e) => setEditing({ ...editing, targetId: e.target.value || null })}
                  style={inputStyle}
                />
              </Field>
            )}

            <div className="adm-fields-3">
              <Field label="ລຳດັບ">
                <input
                  type="number"
                  min={0}
                  value={editing.order}
                  onChange={(e) => setEditing({ ...editing, order: Number(e.target.value) })}
                  style={inputStyle}
                />
              </Field>
              <Field label="ເລີ່ມສະແດງ">
                <input
                  type="date"
                  value={dateInput(editing.startDate)}
                  onChange={(e) => setEditing({ ...editing, startDate: e.target.value || null })}
                  style={inputStyle}
                />
              </Field>
              <Field label="ຢຸດສະແດງ">
                <input
                  type="date"
                  value={dateInput(editing.endDate)}
                  onChange={(e) => setEditing({ ...editing, endDate: e.target.value || null })}
                  style={inputStyle}
                />
              </Field>
            </div>

            <ActiveToggle
              value={editing.isActive}
              onChange={(v) => setEditing({ ...editing, isActive: v })}
            />
            <SaveError error={save.error} />
          </div>
        </Modal>
      )}
    </Card>
  );
}

function ActiveToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ font: f(600, 13), color: c.text }}>ເປີດໃຊ້ງານ</span>
    </label>
  );
}

// ── announcements ────────────────────────────────────────────────────────────

type AnnouncementForm = Omit<Announcement, 'id' | 'createdAt'> & { id?: string };

const EMPTY_ANNOUNCEMENT: AnnouncementForm = {
  title: '',
  content: null,
  audience: 'ALL',
  startDate: null,
  endDate: null,
  isActive: true,
};

function AnnouncementsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AnnouncementForm | null>(null);

  const list = useQuery({
    queryKey: ['content', 'announcements'],
    queryFn: () => api.get<Announcement[]>('/admin/content/announcements'),
  });

  const save = useMutation({
    mutationFn: (body: AnnouncementForm) => api.post('/admin/content/announcements', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['content', 'announcements'] });
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/admin/content/announcements/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['content', 'announcements'] }),
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const rows = list.data ?? [];

  return (
    <Card padding={24}>
      <CardTitle
        right={
          <Button size="sm" onClick={() => setEditing({ ...EMPTY_ANNOUNCEMENT })}>
            + ປະກາດໃໝ່
          </Button>
        }
      >
        ປະກາດ
      </CardTitle>

      {!rows.length && !list.isLoading && (
        <EmptyState message="ຍັງບໍ່ມີປະກາດ" hint="ປະກາດສະແດງໃນໜ້າຫຼັກຂອງກຸ່ມທີ່ເລືອກ" />
      )}

      {rows.map((a, i) => {
        const when = windowLabel(a.startDate, a.endDate);
        return (
          <Row key={a.id} last={i === rows.length - 1}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: f(700, 13.5), color: c.text }}>{a.title}</div>
              {a.content && (
                <div style={{ font: f(400, 12, 18), color: c.muted, marginTop: 2 }}>{a.content}</div>
              )}
              <div style={{ font: f(400, 11), color: c.faint, marginTop: 4 }}>
                {AUDIENCE_LABEL[a.audience]}
                {when && ` · ${when}`}
                {a.createdAt && ` · ສ້າງ ${laoDateTime(a.createdAt)}`}
              </div>
            </div>
            <LiveState isActive={a.isActive} startDate={a.startDate} endDate={a.endDate} />
            <Button
              size="sm"
              variant="ghost"
              title={`ແກ້ໄຂ ${a.title}`}
              onClick={() =>
                setEditing({
                  id: a.id,
                  title: a.title,
                  content: a.content,
                  audience: a.audience,
                  startDate: a.startDate,
                  endDate: a.endDate,
                  isActive: a.isActive,
                })
              }
            >
              ແກ້ໄຂ
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(a.id)}
            >
              ລຶບ
            </Button>
          </Row>
        );
      })}

      <SaveError error={remove.error} />

      {editing && (
        <Modal
          title={editing.id ? 'ແກ້ໄຂປະກາດ' : 'ປະກາດໃໝ່'}
          width={520}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={save.isPending}>
                ຍົກເລີກ
              </Button>
              <Button
                disabled={save.isPending || editing.title.trim().length < 1}
                onClick={() => save.mutate(editing)}
              >
                {save.isPending ? 'ກຳລັງບັນທຶກ...' : 'ບັນທຶກ'}
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="ຫົວຂໍ້">
              <input
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                style={inputStyle}
              />
            </Field>
            <Field label="ເນື້ອຫາ">
              <textarea
                value={editing.content ?? ''}
                onChange={(e) => setEditing({ ...editing, content: e.target.value || null })}
                rows={4}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </Field>
            <Field label="ສະແດງໃຫ້ໃຜເຫັນ">
              <div style={{ display: 'flex', gap: 8 }}>
                {(['ALL', 'CUSTOMER', 'PARTNER'] as Audience[]).map((v) => {
                  const on = editing.audience === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setEditing({ ...editing, audience: v })}
                      style={{
                        flex: 1,
                        padding: 11,
                        borderRadius: 10,
                        font: f(600, 12),
                        cursor: 'pointer',
                        background: on ? c.accentSoft : '#fff',
                        border: `1px solid ${on ? c.accent : c.border}`,
                        color: on ? c.accentDark : c.muted,
                      }}
                    >
                      {AUDIENCE_LABEL[v]}
                    </button>
                  );
                })}
              </div>
            </Field>
            <div className="adm-fields-2">
              <Field label="ເລີ່ມສະແດງ">
                <input
                  type="date"
                  value={dateInput(editing.startDate)}
                  onChange={(e) => setEditing({ ...editing, startDate: e.target.value || null })}
                  style={inputStyle}
                />
              </Field>
              <Field label="ຢຸດສະແດງ">
                <input
                  type="date"
                  value={dateInput(editing.endDate)}
                  onChange={(e) => setEditing({ ...editing, endDate: e.target.value || null })}
                  style={inputStyle}
                />
              </Field>
            </div>
            <ActiveToggle
              value={editing.isActive}
              onChange={(v) => setEditing({ ...editing, isActive: v })}
            />
            <SaveError error={save.error} />
          </div>
        </Modal>
      )}
    </Card>
  );
}

// ── FAQs ─────────────────────────────────────────────────────────────────────

type FaqForm = Omit<Faq, 'id'> & { id?: string };

const EMPTY_FAQ: FaqForm = {
  category: null,
  question: '',
  answer: '',
  order: 0,
  isActive: true,
};

function FaqsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<FaqForm | null>(null);

  const list = useQuery({
    queryKey: ['content', 'faqs'],
    queryFn: () => api.get<Faq[]>('/admin/content/faqs'),
  });

  const save = useMutation({
    // `displayOrder` is what the DTO calls it; the read spells it `order`.
    mutationFn: (body: FaqForm) =>
      api.post('/admin/content/faqs', {
        id: body.id,
        category: body.category ?? undefined,
        question: body.question,
        answer: body.answer,
        displayOrder: body.order,
        isActive: body.isActive,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['content', 'faqs'] });
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/admin/content/faqs/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['content', 'faqs'] }),
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const rows = list.data ?? [];
  const categories = [...new Set(rows.map((r) => r.category).filter(Boolean))] as string[];

  return (
    <Card padding={24}>
      <CardTitle
        right={
          <Button size="sm" onClick={() => setEditing({ ...EMPTY_FAQ, order: rows.length })}>
            + ຄຳຖາມໃໝ່
          </Button>
        }
      >
        ຄຳຖາມທີ່ພົບເລື້ອຍ
      </CardTitle>

      {!rows.length && !list.isLoading && <EmptyState message="ຍັງບໍ່ມີຄຳຖາມ" />}

      {rows.map((q, i) => (
        <Row key={q.id} last={i === rows.length - 1}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: f(700, 13.5), color: c.text }}>{q.question}</div>
            <div style={{ font: f(400, 12, 19), color: c.muted, marginTop: 3 }}>{q.answer}</div>
            <div style={{ font: f(400, 11), color: c.faint, marginTop: 4 }}>
              {q.category ?? 'ອື່ນໆ'} · ລຳດັບ {q.order}
            </div>
          </div>
          <LiveState isActive={q.isActive} startDate={null} endDate={null} />
          <Button
            size="sm"
            variant="ghost"
            title={`ແກ້ໄຂ ${q.question}`}
            onClick={() => setEditing({ ...q })}
          >
            ແກ້ໄຂ
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={remove.isPending}
            onClick={() => remove.mutate(q.id)}
          >
            ລຶບ
          </Button>
        </Row>
      ))}

      <SaveError error={remove.error} />

      {editing && (
        <Modal
          title={editing.id ? 'ແກ້ໄຂຄຳຖາມ' : 'ຄຳຖາມໃໝ່'}
          width={520}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={save.isPending}>
                ຍົກເລີກ
              </Button>
              <Button
                disabled={
                  save.isPending ||
                  editing.question.trim().length < 3 ||
                  editing.answer.trim().length < 3
                }
                onClick={() => save.mutate(editing)}
              >
                {save.isPending ? 'ກຳລັງບັນທຶກ...' : 'ບັນທຶກ'}
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="ຄຳຖາມ">
              <input
                value={editing.question}
                onChange={(e) => setEditing({ ...editing, question: e.target.value })}
                style={inputStyle}
              />
            </Field>
            <Field label="ຄຳຕອບ">
              <textarea
                value={editing.answer}
                onChange={(e) => setEditing({ ...editing, answer: e.target.value })}
                rows={5}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </Field>
            <div className="adm-fields-wide-narrow">
              <Field label="ໝວດ" hint={categories.length ? `ມີຢູ່: ${categories.join(' · ')}` : undefined}>
                <input
                  value={editing.category ?? ''}
                  onChange={(e) => setEditing({ ...editing, category: e.target.value || null })}
                  list="faq-categories"
                  style={inputStyle}
                />
                <datalist id="faq-categories">
                  {categories.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </Field>
              <Field label="ລຳດັບ">
                <input
                  type="number"
                  min={0}
                  value={editing.order}
                  onChange={(e) => setEditing({ ...editing, order: Number(e.target.value) })}
                  style={inputStyle}
                />
              </Field>
            </div>
            <ActiveToggle
              value={editing.isActive}
              onChange={(v) => setEditing({ ...editing, isActive: v })}
            />
            <SaveError error={save.error} />
          </div>
        </Modal>
      )}
    </Card>
  );
}

// ── static pages ─────────────────────────────────────────────────────────────

function PagesTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AppPage | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ['content', 'pages'],
    queryFn: () => api.get<AppPage[]>('/admin/content/pages'),
  });

  const save = useMutation({
    mutationFn: (body: AppPage) =>
      api.post('/admin/content/pages', {
        slug: body.slug,
        title: body.title,
        content: body.content ?? '',
        isActive: body.isActive,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['content', 'pages'] });
      setEditing(null);
      setCreating(false);
    },
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const rows = list.data ?? [];
  const slugTaken = creating && rows.some((p) => p.slug === editing?.slug);

  return (
    <Card padding={24}>
      <CardTitle
        right={
          <Button
            size="sm"
            onClick={() => {
              setCreating(true);
              setEditing({ slug: '', title: '', content: '', isActive: false, updatedAt: null });
            }}
          >
            + ໜ້າໃໝ່
          </Button>
        }
      >
        ໜ້າຄົງທີ່
      </CardTitle>

      <div style={{ font: f(400, 12, 19), color: c.muted, marginBottom: 6 }}>
        ໜ້າເຫຼົ່ານີ້ຖືກອ້າງດ້ວຍ slug ຈາກທັງສາມແອັບ ແລະ ຈາກ <code>user_agreements</code> —
        ຈຶ່ງລຶບບໍ່ໄດ້ ມີແຕ່ປິດການສະແດງ.
      </div>

      {rows.map((p, i) => (
        <Row key={p.slug} last={i === rows.length - 1}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: f(700, 13.5), color: c.text }}>{p.title}</div>
            <div style={{ font: f(400, 11), color: c.faint, marginTop: 3 }}>
              /{p.slug}
              {p.updatedAt && ` · ແກ້ລ່າສຸດ ${laoDateTime(p.updatedAt)}`}
              {` · ${(p.content ?? '').length} ຕົວອັກສອນ`}
            </div>
          </div>
          {p.isActive ? (
            <Pill bg={c.successBg} fg={c.successFg}>ເຜີຍແຜ່ແລ້ວ</Pill>
          ) : (
            <Pill bg={c.warnBg} fg={c.warnFg}>ຮ່າງ</Pill>
          )}
          <Button
            size="sm"
            variant="ghost"
            title={`ແກ້ໄຂ /${p.slug}`}
            onClick={() => {
              setCreating(false);
              setEditing({ ...p });
            }}
          >
            ແກ້ໄຂ
          </Button>
        </Row>
      ))}

      {editing && (
        <Modal
          title={creating ? 'ໜ້າໃໝ່' : `ແກ້ໄຂ /${editing.slug}`}
          width={640}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                }}
              >
                ຍົກເລີກ
              </Button>
              <Button
                disabled={
                  save.isPending ||
                  slugTaken ||
                  !/^[a-z0-9][a-z0-9-]{1,118}$/.test(editing.slug) ||
                  editing.title.trim().length < 1
                }
                onClick={() => save.mutate(editing)}
              >
                {save.isPending ? 'ກຳລັງບັນທຶກ...' : 'ບັນທຶກ'}
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field
              label="Slug"
              hint={
                slugTaken
                  ? `ມີໜ້າ /${editing.slug} ຢູ່ແລ້ວ — ບັນທຶກຈະທັບຂອງເກົ່າ`
                  : 'ຕົວພິມນ້ອຍ ຕົວເລກ ແລະ ຂີດກາງ — ປ່ຽນບໍ່ໄດ້ຫຼັງສ້າງ ເພາະລິ້ງອ້າງເຖິງມັນ'
              }
            >
              <input
                value={editing.slug}
                disabled={!creating}
                onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
                placeholder="terms"
                style={inputStyle}
              />
            </Field>
            <Field label="ຫົວຂໍ້">
              <input
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                style={inputStyle}
              />
            </Field>
            <Field label="ເນື້ອຫາ">
              <textarea
                value={editing.content ?? ''}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                rows={14}
                style={{ ...inputStyle, resize: 'vertical', font: f(400, 13, 21) }}
              />
            </Field>
            <ActiveToggle
              value={editing.isActive}
              onChange={(v) => setEditing({ ...editing, isActive: v })}
            />
            <SaveError error={save.error} />
          </div>
        </Modal>
      )}
    </Card>
  );
}
