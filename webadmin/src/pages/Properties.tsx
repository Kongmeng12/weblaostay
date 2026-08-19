import { lazy, Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import type { Paged, PropertyRow, ProvinceCount } from '../lib/types';
import { c, f } from '../theme';
import {
  Button,
  Card,
  Chips,
  DataTable,
  ErrorState,
  Modal,
  Pagination,
  Pill,
  SearchInput,
} from '../components/ui';
import { useDebounced } from '../lib/useDebounced';

/** Leaflet is only wanted once someone opens a property, so it loads then. */
const LocationPicker = lazy(() => import('../components/LocationPicker'));

const LAOS = { minLat: 13.5, maxLat: 22.6, minLng: 100, maxLng: 108 };
const inLaos = (lat: number, lng: number) =>
  lat >= LAOS.minLat && lat <= LAOS.maxLat && lng >= LAOS.minLng && lng <= LAOS.maxLng;

type Filter = 'missing' | 'all';

/**
 * Where a property actually is.
 *
 * This screen exists because nothing else in the product asks. A property is
 * created during partner sign-up with no coordinates, the partner app never
 * offers a field for them, and the guest map and the distance search both go
 * dark without them — so the default filter here is the properties still
 * missing a pin, and the list is a queue to be emptied rather than a catalogue
 * to be browsed.
 */
export function Properties() {
  const [filter, setFilter] = useState<Filter>('missing');
  const [province, setProvince] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PropertyRow | null>(null);

  const q = useDebounced(search, 350);
  const qc = useQueryClient();

  const provinces = useQuery({
    queryKey: ['partners', 'provinces'],
    queryFn: () => api.get<ProvinceCount[]>('/admin/partners/provinces'),
  });

  const list = useQuery({
    queryKey: ['properties', { filter, province, q, page }],
    queryFn: () =>
      api.get<Paged<PropertyRow>>(
        '/admin/properties' +
          qs({
            missingLocation: filter === 'missing' ? true : undefined,
            provinceId: province,
            q,
            page,
            limit: 15,
          }),
      ),
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const missing = list.data?.items.filter((p) => p.lat === null || p.lng === null).length ?? 0;

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
            { value: 'missing', label: 'ຍັງບໍ່ມີພິກັດ' },
            { value: 'all', label: 'ທັງໝົດ' },
          ]}
        />
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
            placeholder="ຄົ້ນຫາທີ່ພັກ..."
            width={260}
          />
        </div>
      </div>

      <Card padding={0}>
        <DataTable
          loading={list.isLoading}
          rows={list.data?.items ?? []}
          keyOf={(r) => r.id}
          onRowClick={(r) => setEditing(r)}
          empty={
            filter === 'missing'
              ? 'ທຸກທີ່ພັກມີພິກັດຄົບແລ້ວ'
              : q
                ? `ບໍ່ພົບທີ່ພັກທີ່ກົງກັບ "${q}"`
                : 'ຍັງບໍ່ມີທີ່ພັກ'
          }
          columns={[
            {
              key: 'name',
              header: 'ທີ່ພັກ',
              render: (r) => (
                <div>
                  <div style={{ font: f(700, 13), color: c.text }}>{r.name}</div>
                  <div style={{ font: f(400, 11), color: c.faint }}>{r.partner}</div>
                </div>
              ),
            },
            {
              key: 'where',
              header: 'ບ່ອນຢູ່',
              render: (r) => (
                <div>
                  <div style={{ color: c.soft }}>
                    {[r.district, r.province].filter(Boolean).join(', ') || '—'}
                  </div>
                  {r.address && (
                    <div style={{ font: f(400, 11), color: c.faint }}>{r.address}</div>
                  )}
                </div>
              ),
            },
            {
              key: 'pin',
              header: 'ພິກັດ',
              align: 'right',
              render: (r) =>
                r.lat !== null && r.lng !== null ? (
                  <span style={{ font: f(500, 11.5), color: c.soft }}>
                    {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                  </span>
                ) : (
                  <Pill bg={c.warnBg} fg={c.warnFg}>ຍັງບໍ່ມີ</Pill>
                ),
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

      {filter === 'all' && missing > 0 && (
        <div style={{ marginTop: 12, font: f(500, 12), color: c.warnFg }}>
          {missing} ທີ່ພັກໃນໜ້ານີ້ຍັງບໍ່ມີພິກັດ — ແຜນທີ່ ແລະ ການຄົ້ນຫາຕາມໄລຍະທາງໃຊ້ບໍ່ໄດ້
        </div>
      )}

      {editing && (
        <LocationModal
          property={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['properties'] });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function LocationModal({
  property,
  onClose,
  onSaved,
}: {
  property: PropertyRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(
    property.lat !== null && property.lng !== null
      ? { lat: property.lat, lng: property.lng }
      : null,
  );

  const save = useMutation({
    mutationFn: (body: { lat: number; lng: number }) =>
      api.patch(`/admin/properties/${property.id}/location`, body),
    onSuccess: onSaved,
  });

  const valid = !!pin && inLaos(pin.lat, pin.lng);

  return (
    <Modal
      title={property.name}
      onClose={onClose}
      width={620}
      footer={
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>ຍົກເລີກ</Button>
          <Button disabled={!valid || save.isPending} onClick={() => pin && save.mutate(pin)}>
            {save.isPending ? 'ກຳລັງບັນທຶກ...' : 'ບັນທຶກພິກັດ'}
          </Button>
        </div>
      }
    >
      <div style={{ font: f(400, 12.5, 19), color: c.soft, marginBottom: 12 }}>
        {[property.address, property.district, property.province].filter(Boolean).join(' · ') ||
          'ບໍ່ມີທີ່ຢູ່ບັນທຶກໄວ້'}
      </div>

      <Suspense
        fallback={
          <div
            style={{
              height: 320,
              borderRadius: 12,
              background: c.bg,
              display: 'grid',
              placeItems: 'center',
              font: f(500, 12),
              color: c.faint,
            }}
          >
            ກຳລັງໂຫຼດແຜນທີ່...
          </div>
        }
      >
        <LocationPicker value={pin} onChange={setPin} />
      </Suspense>

      {save.isError && (
        <div style={{ marginTop: 10, font: f(500, 12), color: c.dangerFg }}>
          ບັນທຶກບໍ່ໄດ້ — {(save.error as Error).message}
        </div>
      )}
    </Modal>
  );
}
