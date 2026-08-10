import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import type { Paged, PartnerRow, ProvinceCount } from '../lib/types';
import { c, f, pillFor, PARTNER_STATUS_PILL, avatarFor } from '../theme';
import { kip, laoDate, stars } from '../lib/format';
import {
  Card,
  DataTable,
  Pill,
  SearchInput,
  Chips,
  Pagination,
  ErrorState,
  Avatar,
} from '../components/ui';
import { useDebounced } from '../lib/useDebounced';

/** Mirrors `partner_status`. */
type Filter = 'all' | 'verified' | 'pending' | 'rejected' | 'suspended';

export function Partners() {
  const [filter, setFilter] = useState<Filter>('all');
  const [province, setProvince] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const q = useDebounced(search, 350);

  const provinces = useQuery({
    queryKey: ['partners', 'provinces'],
    queryFn: () => api.get<ProvinceCount[]>('/admin/partners/provinces'),
  });

  const list = useQuery({
    queryKey: ['partners', { filter, province, q, page }],
    queryFn: () =>
      api.get<Paged<PartnerRow>>(
        '/admin/partners' +
          qs({
            status: filter === 'all' ? undefined : filter,
            provinceId: province,
            q,
            page,
            limit: 15,
          }),
      ),
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  return (
    <div>
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
            { value: 'all', label: 'ທັງໝົດ' },
            { value: 'verified', label: 'ຢືນຢັນແລ້ວ' },
            { value: 'pending', label: 'ລໍອະນຸມັດ' },
            { value: 'rejected', label: 'ບໍ່ຜ່ານ' },
            { value: 'suspended', label: 'ລະງັບ' },
          ]}
        />
        {/* Wraps: a province picker and a search box side by side are wider
            than a phone, and neither may be pushed off the screen. */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={province}
            onChange={(e) => {
              setProvince(e.target.value);
              setPage(1);
            }}
            style={{
              padding: '10px 14px',
              background: '#fff',
              border: `1px solid ${c.border}`,
              borderRadius: 11,
              font: f(600, 12),
              color: c.soft,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="">ທຸກແຂວງ</option>
            {/* A property with no province set groups under a null id, which
                cannot be filtered on — so it is listed but not selectable. */}
            {provinces.data?.map((p) => (
              <option key={p.province} value={p.id ?? ''} disabled={p.id === null}>
                {p.province} ({p.count})
              </option>
            ))}
          </select>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="ຄົ້ນຫາ ທີ່ພັກ / ເຈົ້າຂອງ..."
            width={280}
          />
        </div>
      </div>

      <Card padding={0}>
        <DataTable
          loading={list.isLoading}
          rows={list.data?.items ?? []}
          keyOf={(r) => r.id}
          empty={q ? `ບໍ່ພົບ Partner ທີ່ກົງກັບ "${q}"` : 'ຍັງບໍ່ມີ Partner'}
          columns={[
            {
              key: 'property',
              header: 'ທີ່ພັກ',
              render: (r) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <Avatar gradient={avatarFor(r.id)} size={40} />
                  <div>
                    <div style={{ font: f(700, 13), color: c.text }}>{r.businessName}</div>
                    <div style={{ font: f(400, 11), color: c.faint }}>
                      {[r.ownerName, r.phone].filter(Boolean).join(' · ') || r.email}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              key: 'province',
              header: 'ແຂວງ',
              render: (r) => (r.provinces.length ? r.provinces.join(', ') : '—'),
            },
            {
              key: 'rooms',
              header: 'ຫ້ອງ',
              align: 'right',
              render: (r) => (
                <>
                  <div style={{ color: c.text, fontWeight: 600 }}>{r.roomCount}</div>
                  {r.propertyCount > 1 && (
                    <div style={{ font: f(400, 10), color: c.faint }}>
                      {r.propertyCount} ທີ່ພັກ
                    </div>
                  )}
                </>
              ),
            },
            {
              key: 'rating',
              header: 'ຄະແນນ',
              render: (r) =>
                r.rating !== null ? (
                  <>
                    <div style={{ color: '#C89B4A', font: f(600, 12) }}>
                      {stars(Math.round(r.rating))}
                    </div>
                    <div style={{ font: f(400, 11), color: c.faint }}>
                      {r.rating.toFixed(1)} · {r.reviewCount} ຮີວິວ
                    </div>
                  </>
                ) : (
                  <span style={{ color: c.faint }}>—</span>
                ),
            },
            {
              key: 'commission',
              header: 'ຄ່າຄອມ',
              align: 'right',
              render: (r) => `${r.commissionRate}%`,
            },
            {
              key: 'revenue',
              header: 'ລາຍໄດ້ລວມ',
              align: 'right',
              render: (r) => <b style={{ color: c.accent }}>{kip(r.revenue)}</b>,
            },
            { key: 'joined', header: 'ເຂົ້າຮ່ວມ', render: (r) => laoDate(r.createdAt) },
            {
              key: 'status',
              header: 'ສະຖານະ',
              align: 'right',
              render: (r) => {
                const p = pillFor(PARTNER_STATUS_PILL, r.status);
                return <Pill bg={p.bg} fg={p.fg}>{p.label}</Pill>;
              },
            },
          ]}
        />
        {list.data && (
          <Pagination
            page={list.data.page}
            pages={list.data.pages}
            total={list.data.total}
            onChange={setPage}
          />
        )}
      </Card>
    </div>
  );
}
