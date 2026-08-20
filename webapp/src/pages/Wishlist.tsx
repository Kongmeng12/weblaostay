import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { c, radius, PROPERTY_TYPE_LABEL, type as t } from '../theme';
import { kip } from '../lib/format';
import { Button, Empty, ErrorNote, Page, PageTitle, Photo, Skeleton, Stars } from '../components/ui';
import type { WishlistItem } from '../lib/types';

export function WishlistPage() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['wishlist'],
    queryFn: () => api.get<WishlistItem[]>('/customer/wishlist'),
  });

  const remove = useMutation({
    mutationFn: (propertyId: string) => api.post(`/customer/wishlist/${propertyId}/remove`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['wishlist'] }),
  });

  return (
    <Page width="wide">
      <PageTitle>ທີ່ພັກທີ່ມັກ</PageTitle>

      {query.isError && <ErrorNote error={query.error} onRetry={() => void query.refetch()} />}

      {query.isLoading ? (
        <div
          style={{
            display: 'grid',
            gap: 18,
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          }}
        >
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} height={280} />
          ))}
        </div>
      ) : query.data?.length ? (
        <div
          style={{
            display: 'grid',
            gap: 18,
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          }}
        >
          {query.data.map((item) => (
            <div
              key={item.propertyId}
              style={{
                background: c.surface,
                border: `1px solid ${c.border}`,
                borderRadius: radius.lg,
                overflow: 'hidden',
              }}
            >
              <Link to={`/property/${item.propertyId}`}>
                <Photo url={item.photo} alt={item.name} height={168} rounded={0} />
              </Link>

              <div style={{ padding: 14 }}>
                <Link
                  to={`/property/${item.propertyId}`}
                  style={{ font: t.h3, color: c.text, display: 'block', marginBottom: 3 }}
                >
                  {item.name}
                </Link>
                <div style={{ font: t.caption, color: c.muted, marginBottom: 8 }}>
                  {[PROPERTY_TYPE_LABEL[item.type] ?? item.type, item.province]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <Stars value={item.rating} count={item.reviewCount} />

                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: `1px solid ${c.divider}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <span style={{ font: t.h3, color: c.accent }}>
                    {/* Null when the property has no active room type to quote. */}
                    {item.fromPricePerNight === null ? 'ຍັງບໍ່ມີລາຄາ' : kip(item.fromPricePerNight)}
                  </span>
                  <button
                    onClick={() => remove.mutate(item.propertyId)}
                    disabled={remove.isPending}
                    style={{
                      background: 'none',
                      border: 'none',
                      font: t.caption,
                      color: c.muted,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    ເອົາອອກ
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon="♡"
          message="ຍັງບໍ່ມີທີ່ພັກທີ່ບັນທຶກໄວ້"
          hint="ກົດ ♡ ຢູ່ໜ້າທີ່ພັກເພື່ອບັນທຶກໄວ້ເບິ່ງພາຍຫຼັງ"
          action={
            <Link to="/search">
              <Button size="lg">ຄົ້ນຫາທີ່ພັກ</Button>
            </Link>
          }
        />
      )}
    </Page>
  );
}
