import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import type { Paged, ReviewRow } from '../lib/types';
import { c, f, radius, avatarFor, pillFor, REVIEW_STATUS_PILL } from '../theme';
import { laoDate, stars, initials } from '../lib/format';
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

/** `all` plus every `review_status`. */
type Filter = 'all' | 'published' | 'flagged' | 'hidden' | 'pending';

interface ReviewCounts {
  total: number;
  published: number;
  hidden: number;
  flagged: number;
  pending: number;
  averageStars: number | null;
}

export function Reviews() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const q = useDebounced(search, 350);

  const counts = useQuery({
    queryKey: ['reviews', 'counts'],
    queryFn: () => api.get<ReviewCounts>('/admin/reviews/counts'),
  });

  const list = useQuery({
    queryKey: ['reviews', { filter, q, page }],
    queryFn: () =>
      api.get<Paged<ReviewRow>>(
        '/admin/reviews' +
          qs({ status: filter === 'all' ? undefined : filter, q, page, limit: 12 }),
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

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const rows = list.data?.items ?? [];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 22 }}>
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
            { value: 'pending', label: 'ລໍກວດ', count: counts.data?.pending },
          ]}
        />
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="ຄົ້ນຫາ ຂໍ້ຄວາມ / ຫົວຂໍ້ / ທີ່ພັກ..."
          width={300}
        />
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
                </div>

                <div style={{ flex: 'none' }}>
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
