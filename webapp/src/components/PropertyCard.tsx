import type { MouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { c, f, radius, PROPERTY_TYPE_LABEL, type as t } from '../theme';
import { api } from '../lib/api';
import { kip } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { usePlannedStay, withStay } from '../lib/stay';
import { Photo } from './ui';
import type { PropertyListing, WishlistItem } from '../lib/types';

/**
 * The stay card — the customer app's `StayCard`: a 16:11 photo with the type
 * tag and a heart on it, then the name with its rating, the place, and the
 * price per night.
 */
export function PropertyCard({ item, to }: { item: PropertyListing; to: string }) {
  // Dates the guest already chose ride along, so the property opens priced
  // for them rather than asking again.
  const stay = usePlannedStay();
  return (
    <Link
      to={withStay(to, stay)}
      className="phaphak-lift"
      style={{
        display: 'block',
        background: c.surface,
        border: `1px solid ${c.border}`,
        borderRadius: radius.lg,
        overflow: 'hidden',
        color: 'inherit',
      }}
    >
      <div style={{ position: 'relative', aspectRatio: '16 / 11' }}>
        <Photo url={item.coverImage} alt={item.name} height="100%" rounded={0} />
        <span style={{ ...chip, left: 10 }}>{PROPERTY_TYPE_LABEL[item.type] ?? item.type}</span>
        {item.distanceKm !== null && (
          <span style={{ ...chip, left: 'auto', right: 56, background: 'rgba(42,31,25,.78)', color: '#fff' }}>
            {item.distanceKm} km
          </span>
        )}
        <WishlistHeart propertyId={item.id} />
      </div>

      <div style={{ padding: '12px 14px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              font: f(700, 15.5, 24),
              color: c.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.name}
          </div>
          {item.reviewCount > 0 ? (
            <span style={{ font: f(700, 13, 20), color: c.text, flex: 'none' }}>
              <span style={{ color: c.star }}>★</span> {item.rating.toFixed(1)}
            </span>
          ) : (
            <span style={{ font: t.caption, color: c.faint, flex: 'none' }}>ໃໝ່</span>
          )}
        </div>

        <div style={{ font: f(400, 12.5, 20), color: c.muted, marginTop: 2 }}>
          {[item.district, item.province].filter(Boolean).join(', ') || '—'}
        </div>

        <div
          style={{
            marginTop: 8,
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          {/* With dates, the honest headline is what the whole stay costs.
              Without them, all we can promise is the cheapest room's rate. */}
          {item.staySubtotal !== null && item.nights ? (
            <div>
              <span style={{ font: f(800, 15, 22), color: c.text }}>{kip(item.staySubtotal)}</span>
              <span style={{ font: t.caption, color: c.muted }}> / {item.nights} ຄືນ</span>
            </div>
          ) : (
            <div>
              <span style={{ font: t.caption, color: c.muted }}>ເລີ່ມ </span>
              <span style={{ font: f(800, 15, 22), color: c.text }}>{kip(item.fromPricePerNight)}</span>
              <span style={{ font: t.caption, color: c.muted }}> / ຄືນ</span>
            </div>
          )}

          {item.availableRoomTypes > 0 && item.staySubtotal !== null && (
            <span style={{ font: t.caption, color: c.successFg }}>ວ່າງ {item.availableRoomTypes} ແບບ</span>
          )}
        </div>
      </div>
    </Link>
  );
}

const chip: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  background: 'rgba(255,255,255,.92)',
  padding: '4px 10px',
  borderRadius: radius.pill,
  font: f(700, 11, 18),
  color: c.text,
};

/**
 * The heart on the photo. Every card on a page reads the same `['wishlist']`
 * query the property page uses, so a page of twelve cards makes one request,
 * and saving here shows as saved there. A signed-out guest is sent to sign in
 * and brought back.
 */
function WishlistHeart({ propertyId }: { propertyId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const wishlist = useQuery({
    queryKey: ['wishlist'],
    queryFn: () => api.get<WishlistItem[]>('/customer/wishlist'),
    enabled: !!user,
  });
  const saved = wishlist.data?.some((w) => w.propertyId === propertyId) ?? false;

  const toggle = useMutation({
    mutationFn: () =>
      saved
        ? api.post(`/customer/wishlist/${propertyId}/remove`)
        : api.post(`/customer/wishlist/${propertyId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['wishlist'] }),
  });

  function onClick(e: MouseEvent) {
    // The heart sits inside the card's link.
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      navigate('/signin', { state: { from: location.pathname + location.search } });
      return;
    }
    if (!toggle.isPending) toggle.mutate();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={saved ? 'ເອົາອອກຈາກທີ່ມັກ' : 'ບັນທຶກໄວ້ໃນທີ່ມັກ'}
      aria-pressed={saved}
      style={{
        position: 'absolute',
        top: 6,
        right: 6,
        width: 44,
        height: 44,
        display: 'grid',
        placeItems: 'center',
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          background: 'rgba(255,255,255,.92)',
          display: 'grid',
          placeItems: 'center',
          color: saved ? c.accent : c.text,
        }}
      >
        <HeartIcon filled={saved} />
      </span>
    </button>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.3 1.1 5 3 1.7-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" />
    </svg>
  );
}
