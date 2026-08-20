import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { c, radius, space, type as t, TAP, PROPERTY_TYPE_LABEL } from '../theme';
import type { District, Province } from '../lib/types';
import { Button } from './ui';
import { DateRangePicker } from './DateRangePicker';

export interface SearchCriteria {
  q: string;
  provinceId: string;
  districtId: string;
  type: string;
  /** Kip per night. Empty string means "no bound", not zero. */
  minPrice: string;
  maxPrice: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  /** Set only by "near me" — the API sorts and filters by distance from here. */
  lat: string;
  lng: string;
}

export function blankCriteria(): SearchCriteria {
  return {
    q: '',
    provinceId: '',
    districtId: '',
    type: '',
    minPrice: '',
    maxPrice: '',
    checkIn: '',
    checkOut: '',
    guests: 2,
    lat: '',
    lng: '',
  };
}

/**
 * The four values `property_type` allows, labelled from the map the rest of the
 * app already displays them with — a second list here would be one enum change
 * away from showing a type the API would reject.
 */
const TYPES = Object.entries(PROPERTY_TYPE_LABEL);

/**
 * The search form.
 *
 * Dates are optional: without them the API returns every active property at its
 * base price, which is the right answer for someone still deciding where to go.
 * Supply both and the results narrow to properties that can actually take the
 * stay, priced for those exact nights.
 */
export function SearchBar({
  value,
  onSearch,
  compact,
}: {
  value: SearchCriteria;
  onSearch: (next: SearchCriteria) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(value);

  /**
   * Re-seeds when the criteria change from outside the form.
   *
   * `useState(value)` only reads its argument once, so anything that alters the
   * search without going through these fields — the "near me" button, the sort
   * picker, the back button — used to leave the form displaying the criteria it
   * was first mounted with. Comparing the serialised value rather than the
   * object avoids re-seeding on every render, which would throw away what the
   * guest is halfway through typing.
   */
  const seed = JSON.stringify(value);
  useEffect(() => {
    setDraft(JSON.parse(seed) as SearchCriteria);
  }, [seed]);

  const { data: provinces } = useQuery({
    queryKey: ['provinces'],
    queryFn: () => api.get<Province[]>('/locations/provinces'),
    staleTime: 60 * 60 * 1000,
  });

  // Districts only mean anything inside a province, so they are fetched per
  // province rather than all 148 at once into a select nobody can scan.
  const { data: districts } = useQuery({
    queryKey: ['districts', draft.provinceId],
    queryFn: () => api.get<District[]>(`/locations/districts?provinceId=${draft.provinceId}`),
    enabled: !!draft.provinceId,
    staleTime: 60 * 60 * 1000,
  });

  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState('');

  /**
   * Hands the search a pair of coordinates so the API can sort by distance.
   *
   * The permission prompt is the browser's, and a refusal is a normal answer
   * rather than a fault — it just leaves the search as it was.
   */
  function locate() {
    if (!navigator.geolocation) {
      setLocateError('ເບຣົາເຊີນີ້ບອກຕຳແໜ່ງບໍ່ໄດ້');
      return;
    }
    setLocating(true);
    setLocateError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onSearch({
          ...draft,
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
          // A place-name search and "near me" answer different questions, and
          // the API would apply both at once.
          q: '',
          provinceId: '',
          districtId: '',
        });
      },
      () => {
        setLocating(false);
        setLocateError('ບອກຕຳແໜ່ງບໍ່ໄດ້ — ກະລຸນາອະນຸຍາດໃນເບຣົາເຊີ');
      },
      { timeout: 10_000, maximumAge: 300_000 },
    );
  }

  // The two dates are not set through this — `DateRangePicker` owns both ends
  // together, which is the only way it can refuse a departure before the
  // arrival instead of quietly correcting one.
  const set = <K extends Exclude<keyof SearchCriteria, 'checkIn' | 'checkOut'>>(
    key: K,
    v: SearchCriteria[K],
  ) => setDraft((d) => ({ ...d, [key]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    onSearch(draft);
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: c.surface,
        border: `1px solid ${c.border}`,
        borderRadius: radius.lg,
        padding: compact ? 12 : 16,
        display: 'grid',
        gap: 10,
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        alignItems: 'end',
      }}
    >
      <Cell label="ໄປໃສ">
        <input
          value={draft.q}
          onChange={(e) => set('q', e.target.value)}
          placeholder="ຊື່ທີ່ພັກ ຫຼື ຄຳຄົ້ນຫາ"
          style={cellInput}
        />
      </Cell>

      <Cell label="ແຂວງ">
        <select
          value={draft.provinceId}
          onChange={(e) => {
            // The districts of the old province do not exist in the new one,
            // so keeping the id would silently filter to nothing.
            setDraft((d) => ({ ...d, provinceId: e.target.value, districtId: '' }));
          }}
          style={cellInput}
        >
          <option value="">ທຸກແຂວງ</option>
          {provinces?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.propertyCount ? ` (${p.propertyCount})` : ''}
            </option>
          ))}
        </select>
      </Cell>

      {/* Only once a province is chosen — a district list on its own is 148
          names with no context. */}
      {!!draft.provinceId && (
        <Cell label="ເມືອງ">
          <select
            value={draft.districtId}
            onChange={(e) => set('districtId', e.target.value)}
            style={cellInput}
          >
            <option value="">ທຸກເມືອງ</option>
            {districts?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Cell>
      )}

      <Cell label="ປະເພດ">
        <select value={draft.type} onChange={(e) => set('type', e.target.value)} style={cellInput}>
          <option value="">ທຸກປະເພດ</option>
          {TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Cell>

      <Cell label="ຜູ້ເຂົ້າພັກ">
        <select
          value={draft.guests}
          onChange={(e) => set('guests', Number(e.target.value))}
          style={cellInput}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} ຄົນ
            </option>
          ))}
        </select>
      </Cell>

      {/* Takes the whole row: a two-month calendar has nowhere to open inside
          a 150px grid cell, and the arrival and departure belong together. */}
      <div style={{ gridColumn: '1 / -1' }}>
        <DateRangePicker
          checkIn={draft.checkIn}
          checkOut={draft.checkOut}
          onChange={({ checkIn, checkOut }) => setDraft((d) => ({ ...d, checkIn, checkOut }))}
        />
      </div>

      {/* Price is a range, so both ends share one cell — two separate labelled
          fields would read as two unrelated filters. */}
      <Cell label="ລາຄາຕໍ່ຄືນ (ກີບ)">
        <div style={{ display: 'flex', alignItems: 'center', gap: space[2] }}>
          <input
            value={draft.minPrice}
            onChange={(e) => set('minPrice', e.target.value.replace(/\D/g, ''))}
            placeholder="ຕ່ຳສຸດ"
            inputMode="numeric"
            style={cellInput}
          />
          <span style={{ font: t.caption, color: c.faint }}>—</span>
          <input
            value={draft.maxPrice}
            onChange={(e) => set('maxPrice', e.target.value.replace(/\D/g, ''))}
            placeholder="ສູງສຸດ"
            inputMode="numeric"
            style={cellInput}
          />
        </div>
      </Cell>

      <div
        style={{
          gridColumn: '1 / -1',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: space[3],
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: space[3], flexWrap: 'wrap' }}>
          <Button type="button" variant="outline" onClick={locate} disabled={locating}>
            {locating ? 'ກຳລັງຫາຕຳແໜ່ງ...' : '📍 ໃກ້ຂ້ອຍ'}
          </Button>
          {draft.lat && !locateError && (
            <span style={{ font: t.caption, color: c.soft }}>
              ຄົ້ນຫາຈາກຕຳແໜ່ງຂອງທ່ານ
              <button
                type="button"
                onClick={() => onSearch({ ...draft, lat: '', lng: '' })}
                style={{
                  background: 'none',
                  border: 'none',
                  minHeight: TAP,
                  padding: `0 ${space[2]}px`,
                  font: t.label,
                  color: c.accent,
                  cursor: 'pointer',
                }}
              >
                ຍົກເລີກ
              </button>
            </span>
          )}
          {locateError && <span style={{ font: t.caption, color: c.warnFg }}>{locateError}</span>}
        </div>

        <Button type="submit" size="lg" style={{ height: 46, minWidth: 160 }}>
          ຄົ້ນຫາ
        </Button>
      </div>
    </form>
  );
}

const cellInput: React.CSSProperties = {
  width: '100%',
  height: 46,
  padding: '0 12px',
  background: c.bg,
  border: `1px solid ${c.border}`,
  borderRadius: radius.md,
  font: t.bodySm,
  color: c.text,
  outline: 'none',
};

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', minWidth: 0 }}>
      <span style={{ font: t.label, color: c.muted, display: 'block', marginBottom: space[1] }}>
        {label}
      </span>
      {children}
    </label>
  );
}
