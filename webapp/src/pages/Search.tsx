import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { c, type as t, MAX_WIDTH, TAP } from '../theme';
import { nightsBetween } from '../lib/format';
import { Button, Empty, ErrorNote, Loading, Skeleton } from '../components/ui';
import { PropertyCard } from '../components/PropertyCard';
import { SearchBar, blankCriteria, type SearchCriteria } from '../components/SearchBar';
import type { SearchResult } from '../lib/types';

const SORTS = [
  { value: 'rating', label: 'ຄະແນນສູງສຸດ' },
  { value: 'price_asc', label: 'ລາຄາຕ່ຳ → ສູງ' },
  { value: 'price_desc', label: 'ລາຄາສູງ → ຕ່ຳ' },
  { value: 'reviews', label: 'ຮີວິວຫຼາຍສຸດ' },
] as const;

/**
 * Search results.
 *
 * The criteria live in the URL, not in component state: a guest who finds a
 * property they like will send the link to whoever they are travelling with,
 * and that link has to reproduce the same search.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams();

  const criteria: SearchCriteria = {
    q: params.get('q') ?? '',
    provinceId: params.get('provinceId') ?? '',
    checkIn: params.get('checkIn') ?? '',
    checkOut: params.get('checkOut') ?? '',
    guests: Number(params.get('guests') ?? 2),
  };
  const sort = params.get('sort') ?? 'rating';
  const page = Number(params.get('page') ?? 1);

  // Both dates or neither — one alone cannot describe a stay, and the API
  // rejects a half-filled range.
  const hasRange = !!criteria.checkIn && !!criteria.checkOut;
  const nights = hasRange ? nightsBetween(criteria.checkIn, criteria.checkOut) : 0;

  const query = useQuery({
    queryKey: ['search', criteria, sort, page],
    queryFn: () =>
      api.get<SearchResult>(
        '/properties' +
          qs({
            q: criteria.q,
            provinceId: criteria.provinceId,
            guests: criteria.guests,
            ...(hasRange ? { checkIn: criteria.checkIn, checkOut: criteria.checkOut } : {}),
            sort,
            page,
            limit: 12,
          }),
      ),
  });

  function apply(next: Partial<SearchCriteria & { sort: string; page: number }>) {
    const merged = { ...criteria, sort, page: 1, ...next };
    setParams(
      new URLSearchParams(
        Object.entries({
          q: merged.q,
          provinceId: merged.provinceId,
          checkIn: merged.checkIn,
          checkOut: merged.checkOut,
          guests: String(merged.guests),
          sort: merged.sort,
          page: merged.page > 1 ? String(merged.page) : '',
        }).filter(([, v]) => v !== '' && v !== undefined) as [string, string][],
      ),
    );
  }

  /** The link into a property, carrying the dates so its prices match. */
  const propertyLink = (id: string) =>
    `/property/${id}` +
    qs({
      ...(hasRange ? { checkIn: criteria.checkIn, checkOut: criteria.checkOut } : {}),
      guests: criteria.guests,
    });

  return (
    <div style={{ maxWidth: MAX_WIDTH, margin: '0 auto', padding: '20px 18px 40px' }}>
      <SearchBar value={criteria} onSearch={(next) => apply(next)} compact />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
          margin: '22px 0 16px',
        }}
      >
        <div style={{ font: t.bodySm, color: c.muted }}>
          {query.isLoading ? (
            'ກຳລັງຄົ້ນຫາ...'
          ) : (
            <>
              ພົບ <b style={{ color: c.text }}>{query.data?.total ?? 0}</b> ທີ່ພັກ
              {hasRange && nights > 0 && ` · ${nights} ຄືນ · ວ່າງຈິງໃນວັນທີ່ເລືອກ`}
            </>
          )}
        </div>

        <select
          value={sort}
          onChange={(e) => apply({ sort: e.target.value })}
          style={{
            minHeight: TAP,
            padding: '9px 12px',
            background: '#fff',
            border: `1px solid ${c.border}`,
            borderRadius: 12,
            font: t.caption,
            color: c.soft,
            cursor: 'pointer',
          }}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {query.isError && (
        <ErrorNote error={query.error} onRetry={() => void query.refetch()} />
      )}

      {query.isLoading ? (
        <Grid>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={318} />
          ))}
        </Grid>
      ) : query.data?.items.length ? (
        <>
          <Grid>
            {query.data.items.map((item) => (
              <PropertyCard key={item.id} item={item} to={propertyLink(item.id)} />
            ))}
          </Grid>

          {query.data.pages > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 14,
                marginTop: 30,
              }}
            >
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => apply({ page: page - 1 })}
              >
                ກ່ອນໜ້າ
              </Button>
              <span style={{ font: t.label, color: c.muted }}>
                {page} / {query.data.pages}
              </span>
              <Button
                variant="outline"
                disabled={page >= query.data.pages}
                onClick={() => apply({ page: page + 1 })}
              >
                ຖັດໄປ
              </Button>
            </div>
          )}
        </>
      ) : (
        <Empty
          message={
            hasRange
              ? 'ບໍ່ມີທີ່ພັກວ່າງໃນວັນທີ່ເລືອກ'
              : 'ບໍ່ພົບທີ່ພັກທີ່ກົງກັບການຄົ້ນຫາ'
          }
          hint={
            hasRange
              ? 'ລອງປ່ຽນວັນທີ່ ຫຼື ຫຼຸດຈຳນວນຜູ້ເຂົ້າພັກ — ຜົນລັບນີ້ນັບສະເພາະຫ້ອງທີ່ວ່າງຈິງທຸກຄືນ'
              : 'ລອງລຶບຄຳຄົ້ນຫາ ຫຼື ເລືອກແຂວງອື່ນ'
          }
          action={
            <Button variant="outline" onClick={() => apply(blankCriteria())}>
              ລ້າງການຄົ້ນຫາ
            </Button>
          }
        />
      )}

      {query.isFetching && !query.isLoading && <Loading label="ກຳລັງອັບເດດ..." />}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 18,
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
      }}
    >
      {children}
    </div>
  );
}
