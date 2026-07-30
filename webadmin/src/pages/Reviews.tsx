import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import type { Paged, ReviewRow } from '../lib/types';
import { c, f, radius, avatarFor } from '../theme';
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

type Filter = 'all' | 'flagged' | 'hidden';

export function Reviews() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const q = useDebounced(search, 350);

  const counts = useQuery({
    queryKey: ['reviews', 'counts'],
    queryFn: () =>
      api.get<{ total: number; flagged: number; hidden: number; averageStars: number | null }>(
        '/admin/reviews/counts',
      ),
  });

  const list = useQuery({
    queryKey: ['reviews', { filter, q, page }],
    queryFn: () =>
      api.get<Paged<ReviewRow>>(
        '/admin/reviews' +
          qs({
            flagged: filter === 'flagged' ? true : undefined,
            hidden: filter === 'hidden' ? true : undefined,
            q,
            page,
            limit: 12,
          }),
      ),
  });

  const toggle = useMutation({
    mutationFn: (vars: { id: string; hide: boolean }) =>
      api.patch(`/admin/reviews/${vars.id}/${vars.hide ? 'hide' : 'unhide'}`),
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
            { value: 'flagged', label: 'ຖືກລາຍງານ', count: counts.data?.flagged },
            { value: 'hidden', label: 'ຖືກເຊື່ອງ', count: counts.data?.hidden },
          ]}
        />
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="ຄົ້ນຫາ ຂໍ້ຄວາມ / ທີ່ພັກ / ແຂກ..."
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
            <Card key={r.id} padding={18} style={{ opacity: r.isHidden ? 0.62 : 1 }}>
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
                      · {laoDate(r.stayedAt)}
                    </span>
                    {r.isFlagged && (
                      <Pill bg={c.dangerBg} fg={c.dangerFg}>ຖືກລາຍງານ</Pill>
                    )}
                    {r.isHidden && <Pill bg={c.neutralBg} fg={c.neutralFg}>ເຊື່ອງຢູ່</Pill>}
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
                    {r.text || <span style={{ color: c.faint }}>(ບໍ່ມີຂໍ້ຄວາມ)</span>}
                  </div>
                </div>

                <div style={{ flex: 'none' }}>
                  <Button
                    size="sm"
                    variant={r.isHidden ? 'success' : 'ghost'}
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate({ id: r.id, hide: !r.isHidden })}
                  >
                    {r.isHidden ? 'ກູ້ຄືນ' : 'ເຊື່ອງ'}
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
