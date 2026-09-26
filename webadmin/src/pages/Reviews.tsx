import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import type { Paged, PropertyReviewCount, ReviewRow, ReviewSort } from '../lib/types';
import { c, f, radius, avatarFor, pillFor, REPORT_REASON_PILL, REVIEW_STATUS_PILL } from '../theme';
import { laoAgo, laoDate, stars, initials } from '../lib/format';
import {
  Card,
  Pill,
  SearchInput,
  Chips,
  Pagination,
  ErrorState,
  Button,
  Avatar,
  EmptyState,
} from '../components/ui';
import { useDebounced } from '../lib/useDebounced';

/**
 * `all`, the `review_status` values, and `awaiting`: reviews with an open hide
 * request from a partner or guest. The review stays published until decided.
 */
type Filter = 'all' | 'published' | 'flagged' | 'hidden' | 'awaiting';

const selectStyle = {
  padding: '10px 14px',
  background: '#fff',
  border: `1px solid ${c.border}`,
  borderRadius: 11,
  font: f(600, 12),
  color: c.soft,
  outline: 'none',
  cursor: 'pointer',
} as const;

interface ReviewCounts {
  total: number;
  published: number;
  hidden: number;
  flagged: number;
  pending: number;
  /** Reviews with an open hide request — the "ລໍກວດ" tab. */
  awaiting: number;
  averageStars: number | null;
}

export function Reviews() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [propertyId, setPropertyId] = useState('');
  const [starFilter, setStarFilter] = useState('');
  const [sort, setSort] = useState<ReviewSort>('newest');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const q = useDebounced(search, 350);

  const counts = useQuery({
    queryKey: ['reviews', 'counts'],
    queryFn: () => api.get<ReviewCounts>('/admin/reviews/counts'),
  });

  const properties = useQuery({
    queryKey: ['reviews', 'properties'],
    queryFn: () => api.get<PropertyReviewCount[]>('/admin/reviews/properties'),
  });

  const list = useQuery({
    queryKey: ['reviews', { filter, propertyId, starFilter, sort, q, page }],
    queryFn: () =>
      api.get<Paged<ReviewRow>>(
        '/admin/reviews' +
          qs({
            status: filter === 'all' || filter === 'awaiting' ? undefined : filter,
            awaiting: filter === 'awaiting' ? 'true' : undefined,
            propertyId,
            stars: starFilter,
            sort,
            q,
            page,
            limit: 12,
          }),
      ),
  });

  /**
   * Hiding a review takes it out of the property's score — the database trigger
   * recomputes `rating_avg` from published rows — so the partner list is
   * invalidated alongside it.
   */
  const toggle = useMutation({
    mutationFn: (vars: { id: string; hide: boolean }) =>
      api.patch(`/admin/reviews/${vars.id}/${vars.hide ? 'hide' : 'publish'}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reviews'] });
      void qc.invalidateQueries({ queryKey: ['partners'] });
    },
  });

  /**
   * Settles a review's open hide requests. Hiding and settling stay two
   * separate calls, so each still lands in the audit log as its own entry.
   */
  const decide = useMutation({
    mutationFn: async (vars: { review: ReviewRow; hide: boolean }) => {
      const { review, hide } = vars;
      if (hide && review.status === 'published') {
        await api.patch(`/admin/reviews/${review.id}/hide`);
      }
      for (const r of review.requests) {
        await api.patch(`/admin/review-reports/${r.id}`, {
          status: hide ? 'reviewed' : 'dismissed',
        });
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['reviews'] });
      void qc.invalidateQueries({ queryKey: ['review-reports'] });
      void qc.invalidateQueries({ queryKey: ['partners'] });
    },
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const rows = list.data?.items ?? [];

  return (
    <div>
      <div className="adm-kpis" style={{ marginBottom: 22 }}>
        <StatBox label="ຮີວິວທັງໝົດ" value={counts.data?.total} />
        <StatBox
          label="ຄະແນນສະເລ່ຍ"
          value={counts.data?.averageStars ?? undefined}
          suffix=" ★"
          color="#C89B4A"
        />
        <StatBox label="ຖືກລາຍງານ" value={counts.data?.flagged} color={c.accent} />
        <StatBox label="ຖືກເຊື່ອງ" value={counts.data?.hidden} color={c.muted} />
      </div>

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
        <Chips<Filter>
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          options={[
            { value: 'all', label: 'ທັງໝົດ', count: counts.data?.total },
            { value: 'published', label: 'ສະແດງຢູ່', count: counts.data?.published },
            { value: 'flagged', label: 'ຖືກລາຍງານ', count: counts.data?.flagged },
            { value: 'hidden', label: 'ຖືກເຊື່ອງ', count: counts.data?.hidden },
            { value: 'awaiting', label: 'ລໍກວດ', count: counts.data?.awaiting },
          ]}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value);
              setPage(1);
            }}
            style={selectStyle}
          >
            <option value="">ທຸກທີ່ພັກ</option>
            {properties.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.property} ({p.count})
              </option>
            ))}
          </select>
          <select
            value={starFilter}
            onChange={(e) => {
              setStarFilter(e.target.value);
              setPage(1);
            }}
            style={selectStyle}
          >
            <option value="">ທຸກຄະແນນ</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {'★'.repeat(n)} ({n})
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as ReviewSort)}
            style={selectStyle}
          >
            <option value="newest">ໃໝ່ສຸດ</option>
            <option value="oldest">ເກົ່າສຸດ</option>
            <option value="highest">ຄະແນນສູງສຸດ</option>
            <option value="lowest">ຄະແນນຕ່ຳສຸດ</option>
          </select>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="ຄົ້ນຫາ ຂໍ້ຄວາມ / ຫົວຂໍ້ / ທີ່ພັກ..."
            width={260}
          />
        </div>
      </div>

      {list.isLoading ? (
        <Card>
          <div style={{ font: f(400, 13), color: c.muted }}>ກຳລັງໂຫຼດ...</div>
        </Card>
      ) : rows.length === 0 ? (
        <Card padding={0}>
          <EmptyState message={q ? `ບໍ່ພົບຮີວິວທີ່ກົງກັບ "${q}"` : 'ຍັງບໍ່ມີຮີວິວ'} />
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {rows.map((r) => (
            <Card key={r.id} padding={18} style={{ opacity: r.status === 'hidden' ? 0.62 : 1 }}>
              <div style={{ display: 'flex', gap: 14 }}>
                <Avatar gradient={avatarFor(r.guest)} size={42} label={initials(r.guest)} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 6,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ font: f(700, 14), color: c.text }}>{r.guest}</span>
                    <span style={{ font: f(400, 12), color: c.muted }}>· {r.property}</span>
                    <span style={{ font: f(400, 11), color: c.faint }}>
                      · {laoDate(r.createdAt)}
                    </span>
                    {(() => {
                      const p = pillFor(REVIEW_STATUS_PILL, r.status);
                      return (
                        <Pill bg={p.bg} fg={p.fg}>
                          {p.label}
                        </Pill>
                      );
                    })()}
                    {r.reports > 0 && (
                      <Pill bg={c.dangerBg} fg={c.dangerFg}>{r.reports} ລາຍງານ</Pill>
                    )}
                  </div>

                  <div
                    style={{
                      font: f(600, 14),
                      color: r.stars >= 4 ? '#C89B4A' : r.stars <= 2 ? c.accent : c.muted,
                      letterSpacing: 1,
                      marginBottom: 8,
                    }}
                  >
                    {stars(r.stars)}
                  </div>

                  <div
                    style={{
                      font: f(400, 13, 21),
                      color: c.soft,
                      background: c.bg,
                      borderRadius: radius.md,
                      padding: '11px 14px',
                    }}
                  >
                    {r.title && (
                      <div style={{ font: f(700, 13), color: c.text, marginBottom: 4 }}>
                        {r.title}
                      </div>
                    )}
                    {r.comment || <span style={{ color: c.faint }}>(ບໍ່ມີຂໍ້ຄວາມ)</span>}
                  </div>

                  {r.requests.length > 0 && (
                    <HideRequests
                      review={r}
                      busy={decide.isPending}
                      onDecide={(hide) => decide.mutate({ review: r, hide })}
                    />
                  )}
                </div>

                <div style={{ flex: 'none', display: r.requests.length > 0 ? 'none' : undefined }}>
                  <Button
                    size="sm"
                    variant={r.status === 'published' ? 'ghost' : 'success'}
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate({ id: r.id, hide: r.status === 'published' })}
                  >
                    {r.status === 'published' ? 'ເຊື່ອງ' : 'ສະແດງ'}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {list.data && list.data.pages > 1 && (
        <Card padding={0} style={{ marginTop: 14 }}>
          <Pagination
            page={list.data.page}
            pages={list.data.pages}
            total={list.data.total}
            onChange={setPage}
          />
        </Card>
      )}
    </div>
  );
}

/**
 * Who asked for the review to be hidden and why, with the decision. The review
 * stays published until a moderator picks one.
 */
function HideRequests({
  review,
  busy,
  onDecide,
}: {
  review: ReviewRow;
  busy: boolean;
  onDecide: (hide: boolean) => void;
}) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: '12px 14px',
        border: `1px solid ${c.border}`,
        borderLeft: `3px solid ${c.accent}`,
        borderRadius: radius.md,
      }}
    >
      {review.requests.map((q) => {
        const reason = pillFor(REPORT_REASON_PILL, q.reason);
        return (
          <div key={q.id} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ font: f(700, 12.5), color: c.text }}>
                🚩 {q.reportedByRole === 'PARTNER' ? 'ເຈົ້າຂອງທີ່ພັກຂໍເຊື່ອງ' : 'ມີຄົນລາຍງານ'}
              </span>
              <Pill bg={reason.bg} fg={reason.fg}>
                {reason.label}
              </Pill>
              <span style={{ font: f(400, 11.5), color: c.faint }}>
                {q.reportedBy} · {laoAgo(q.createdAt)}
              </span>
            </div>
            {q.detail && (
              <p style={{ font: f(400, 12.5, 19), color: c.soft, margin: '6px 0 0' }}>
                “{q.detail}”
              </p>
            )}
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
        <Button size="sm" disabled={busy} onClick={() => onDecide(true)}>
          ເຊື່ອງຮີວິວ
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(false)}>
          ບໍ່ເຊື່ອງ
        </Button>
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  color = c.text,
  suffix = '',
}: {
  label: string;
  value?: number;
  color?: string;
  suffix?: string;
}) {
  return (
    <Card padding={18}>
      <div style={{ font: f(400, 12), color: c.muted, marginBottom: 8 }}>{label}</div>
      <div style={{ font: f(800, 26), color }}>
        {value ?? '—'}
        {value !== undefined ? suffix : ''}
      </div>
    </Card>
  );
}
