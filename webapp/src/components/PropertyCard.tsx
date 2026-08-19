import { Link } from 'react-router-dom';
import { c, f, radius, shadow, PROPERTY_TYPE_LABEL, type as t } from '../theme';
import { kip } from '../lib/format';
import { Photo, Stars } from './ui';
import type { PropertyListing } from '../lib/types';

export function PropertyCard({ item, to }: { item: PropertyListing; to: string }) {
  return (
    <Link
      to={to}
      style={{
        display: 'block',
        background: c.surface,
        border: `1px solid ${c.border}`,
        borderRadius: radius.lg,
        overflow: 'hidden',
        boxShadow: shadow.card,
        color: 'inherit',
      }}
    >
      <div style={{ position: 'relative' }}>
        <Photo url={item.coverImage} alt={item.name} height={176} rounded={0} />
        <span
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            background: 'rgba(255,255,255,.94)',
            padding: '4px 10px',
            borderRadius: 999,
            font: t.caption,
            color: c.soft,
          }}
        >
          {PROPERTY_TYPE_LABEL[item.type] ?? item.type}
        </span>
        {item.distanceKm !== null && (
          <span
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              background: 'rgba(43,30,22,.78)',
              padding: '4px 10px',
              borderRadius: 999,
              font: t.caption,
              color: '#fff',
            }}
          >
            {item.distanceKm} km
          </span>
        )}
      </div>

      <div style={{ padding: 14 }}>
        <div
          style={{
            font: t.h3,
            color: c.text,
            marginBottom: 3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.name}
        </div>

        <div style={{ font: t.caption, color: c.muted, marginBottom: 8 }}>
          {[item.district, item.province].filter(Boolean).join(', ') || '—'}
        </div>

        <Stars value={item.rating} count={item.reviewCount} />

        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: `1px solid ${c.divider}`,
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
              <span style={{ font: f(800, 16, 24), color: c.accent }}>{kip(item.staySubtotal)}</span>
              <span style={{ font: t.caption, color: c.muted }}> / {item.nights} ຄືນ</span>
            </div>
          ) : (
            <div>
              <span style={{ font: t.caption, color: c.muted }}>ເລີ່ມຕົ້ນ </span>
              <span style={{ font: f(800, 16, 24), color: c.accent }}>
                {kip(item.fromPricePerNight)}
              </span>
              <span style={{ font: t.caption, color: c.muted }}> / ຄືນ</span>
            </div>
          )}

          {item.availableRoomTypes > 0 && item.staySubtotal !== null && (
            <span style={{ font: t.caption, color: c.successFg }}>
              ວ່າງ {item.availableRoomTypes} ແບບ
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
