import { useState, type ComponentType } from 'react';
import {
  Accessibility,
  Bath,
  Bike,
  Car,
  Check,
  CigaretteOff,
  Clock,
  CookingPot,
  Croissant,
  Droplets,
  Dumbbell,
  Fan,
  Flower,
  Lock,
  Luggage,
  Microwave,
  MoveVertical,
  PawPrint,
  Plane,
  Refrigerator,
  Shirt,
  ShowerHead,
  Snowflake,
  Square,
  Sun,
  Trees,
  Tv,
  Utensils,
  Waves,
  Wifi,
  Wine,
  type LucideProps,
} from 'lucide-react';
import { c, f, radius, space, type as t } from '../theme';
import { Button, Modal } from './ui';
import type { Amenity } from '../lib/types';

/**
 * `amenities.icon` holds a Lucide icon name (seeded in the amenities table).
 * Mapped by hand rather than looked up by name so the bundle carries these
 * thirty icons and not Lucide's fifteen hundred. A name not listed here —
 * one an admin adds later — falls back to a tick rather than to nothing.
 */
const ICONS: Record<string, ComponentType<LucideProps>> = {
  wifi: Wifi,
  car: Car,
  snowflake: Snowflake,
  fan: Fan,
  tv: Tv,
  refrigerator: Refrigerator,
  lock: Lock,
  'move-vertical': MoveVertical,
  croissant: Croissant,
  utensils: Utensils,
  wine: Wine,
  'cooking-pot': CookingPot,
  microwave: Microwave,
  'shower-head': ShowerHead,
  bath: Bath,
  droplets: Droplets,
  square: Square,
  waves: Waves,
  dumbbell: Dumbbell,
  flower: Flower,
  trees: Trees,
  sun: Sun,
  luggage: Luggage,
  clock: Clock,
  shirt: Shirt,
  plane: Plane,
  bike: Bike,
  'paw-print': PawPrint,
  'cigarette-off': CigaretteOff,
  accessibility: Accessibility,
};

/** `amenities.category`, in the order a guest reads them. */
const CATEGORIES: [string, string][] = [
  ['general', 'ທົ່ວໄປ'],
  ['bathroom', 'ຫ້ອງນ້ຳ'],
  ['kitchen', 'ຫ້ອງຄົວ'],
  ['food', 'ອາຫານ ແລະ ເຄື່ອງດື່ມ'],
  ['facility', 'ສິ່ງອຳນວຍຄວາມສະດວກພາຍໃນ'],
  ['service', 'ບໍລິການ'],
  ['policy', 'ນະໂຍບາຍ'],
  ['accessibility', 'ການເຂົ້າເຖິງ'],
];

/** How many show before "show all" — two even columns of four. */
const PREVIEW = 8;

/**
 * What the property offers, the way international booking sites show it:
 * one card, an icon beside each amenity in two columns, the first eight up
 * front, and the full list grouped by kind behind a "show all".
 */
export function AmenityList({ amenities }: { amenities: Amenity[] }) {
  const [all, setAll] = useState(false);
  const shown = amenities.slice(0, PREVIEW);

  const grouped = [
    ...CATEGORIES,
    // A category added after this list was written still gets its own group.
    ...[...new Set(amenities.map((a) => a.category ?? 'other'))]
      .filter((k) => !CATEGORIES.some(([key]) => key === k))
      .map((k): [string, string] => [k, 'ອື່ນໆ']),
  ]
    .map(([key, label]) => ({ label, items: amenities.filter((a) => (a.category ?? 'other') === key) }))
    .filter((g) => g.items.length > 0);

  return (
    <section
      style={{
        background: c.surface,
        border: `1px solid ${c.border}`,
        borderRadius: radius.lg,
        padding: 20,
        marginBottom: 26,
      }}
    >
      <h2 style={{ font: t.h2, color: c.text, margin: `0 0 ${space[4]}px` }}>ສິ່ງອຳນວຍຄວາມສະດວກ</h2>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
          columnGap: space[5],
          rowGap: space[4],
        }}
      >
        {shown.map((a) => (
          <AmenityRow key={a.id} amenity={a} />
        ))}
      </div>

      {amenities.length > PREVIEW && (
        <Button variant="outline" onClick={() => setAll(true)} style={{ marginTop: space[5] }}>
          ເບິ່ງທັງໝົດ {amenities.length} ລາຍການ
        </Button>
      )}

      {all && (
        <Modal
          title="ສິ່ງອຳນວຍຄວາມສະດວກທັງໝົດ"
          onClose={() => setAll(false)}
          width={560}
          footer={
            <Button variant="outline" onClick={() => setAll(false)}>
              ປິດ
            </Button>
          }
        >
          <div style={{ display: 'grid', gap: space[5] }}>
            {grouped.map((g) => (
              <div key={g.label}>
                <div style={{ font: t.h3, color: c.text, marginBottom: space[3] }}>{g.label}</div>
                <div style={{ display: 'grid', gap: space[3] }}>
                  {g.items.map((a) => (
                    <div key={a.id} style={{ paddingBottom: space[3], borderBottom: `1px solid ${c.divider}` }}>
                      <AmenityRow amenity={a} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </section>
  );
}

function AmenityRow({ amenity }: { amenity: Amenity }) {
  const Icon = (amenity.icon && ICONS[amenity.icon]) || Check;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
      <Icon size={24} strokeWidth={1.6} color={c.text} aria-hidden="true" style={{ flex: 'none' }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ font: f(500, 14.5, 22), color: c.text }}>{amenity.name}</div>
        {amenity.nameEn && amenity.nameEn !== amenity.name && (
          <div style={{ font: f(400, 12, 18), color: c.muted }}>{amenity.nameEn}</div>
        )}
      </div>
    </div>
  );
}
