import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import type { Paged, CustomerRow } from '../lib/types';
import { c, f, pillFor, USER_STATUS_PILL, avatarFor } from '../theme';
import { kip, laoDate, initials } from '../lib/format';
import {
  Card,
  DataTable,
  Pill,
  SearchInput,
  Chips,
  Pagination,
  ErrorState,
  Button,
  Avatar,
  Modal,
} from '../components/ui';
import { useDebounced } from '../lib/useDebounced';

type Filter = 'all' | 'active' | 'suspended';

export function Customers() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<CustomerRow | null>(null);

  const q = useDebounced(search, 350);

  const summary = useQuery({
    queryKey: ['customers', 'summary'],
    queryFn: () => api.get<{ total: number; active: number; suspended: number }>('/admin/customers/summary'),
  });

  const list = useQuery({
    queryKey: ['customers', { filter, q, page }],
    queryFn: () =>
      api.get<Paged<CustomerRow>>(
        '/admin/customers' + qs({ status: filter === 'all' ? undefined : filter, q, page, limit: 15 }),
      ),
  });

  const setStatus = useMutation({
    mutationFn: (vars: { id: string; status: string }) =>
      api.patch(`/admin/customers/${vars.id}/status`, { status: vars.status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      setConfirm(null);
    },
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
            { value: 'all', label: 'ທັງໝົດ', count: summary.data?.total },
            { value: 'active', label: 'ປົກກະຕິ', count: summary.data?.active },
            { value: 'suspended', label: 'ລະງັບ', count: summary.data?.suspended },
          ]}
        />
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="ຄົ້ນຫາ ຊື່ / ອີເມວ / ເບີໂທ..."
          width={300}
        />
      </div>

      <Card padding={0}>
        <DataTable
          loading={list.isLoading}
          rows={list.data?.items ?? []}
          keyOf={(r) => r.id}
          empty={q ? `ບໍ່ພົບລູກຄ້າທີ່ກົງກັບ "${q}"` : 'ຍັງບໍ່ມີລູກຄ້າ'}
          columns={[
            {
              key: 'name',
              header: 'ລູກຄ້າ',
              render: (r) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <Avatar gradient={avatarFor(r.email)} label={initials(r.full_name)} />
                  <div>
                    <div style={{ font: f(700, 13), color: c.text }}>{r.full_name}</div>
                    <div style={{ font: f(400, 11), color: c.faint }}>{r.email}</div>
                  </div>
                </div>
              ),
            },
            { key: 'phone', header: 'ເບີໂທ', render: (r) => r.phone },
            {
              key: 'tier',
              header: 'ຊັ້ນ',
              render: (r) =>
                r.tier === 'gold' ? (
                  <Pill bg="#F6E7C9" fg="#8A6B1F">Gold</Pill>
                ) : (
                  <Pill bg="#E4E2DC" fg="#5C5348">Silver</Pill>
                ),
            },
            { key: 'trips', header: 'ຈຳນວນທຮິບ', align: 'right', render: (r) => r.trips },
            {
              key: 'spent',
              header: 'ໃຊ້ຈ່າຍລວມ',
              align: 'right',
              render: (r) => <b style={{ color: c.accent }}>{kip(r.spent)}</b>,
            },
            { key: 'joined', header: 'ສະໝັກເມື່ອ', render: (r) => laoDate(r.created_at) },
            {
              key: 'status',
              header: 'ສະຖານະ',
              render: (r) => {
                const p = pillFor(USER_STATUS_PILL, r.status);
                return <Pill bg={p.bg} fg={p.fg}>{p.label}</Pill>;
              },
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (r) => (
                <Button
                  size="sm"
                  variant={r.status === 'active' ? 'danger' : 'success'}
                  onClick={() => setConfirm(r)}
                >
                  {r.status === 'active' ? 'ລະງັບ' : 'ກູ້ຄືນ'}
                </Button>
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

      {confirm && (
        <Modal
          title={confirm.status === 'active' ? 'ລະງັບບັນຊີລູກຄ້າ' : 'ກູ້ຄືນບັນຊີລູກຄ້າ'}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)} disabled={setStatus.isPending}>
                ຍົກເລີກ
              </Button>
              <Button
                variant={confirm.status === 'active' ? 'danger' : 'success'}
                disabled={setStatus.isPending}
                onClick={() =>
                  setStatus.mutate({
                    id: confirm.id,
                    status: confirm.status === 'active' ? 'suspended' : 'active',
                  })
                }
              >
                {setStatus.isPending ? 'ກຳລັງດຳເນີນການ...' : 'ຢືນຢັນ'}
              </Button>
            </>
          }
        >
          <div style={{ font: f(400, 13, 21), color: c.soft }}>
            {confirm.status === 'active' ? (
              <>
                <b>{confirm.full_name}</b> ຈະບໍ່ສາມາດຈອງທີ່ພັກໄດ້ອີກຈົນກວ່າຈະກູ້ຄືນ.
                ການຈອງທີ່ມີຢູ່ແລ້ວຈະບໍ່ຖືກຍົກເລີກ.
              </>
            ) : (
              <>
                <b>{confirm.full_name}</b> ຈະກັບມາໃຊ້ງານໄດ້ຕາມປົກກະຕິ.
              </>
            )}
          </div>
          {setStatus.error instanceof Error && (
            <div style={{ marginTop: 14, font: f(500, 12), color: c.dangerFg }}>
              {setStatus.error.message}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
