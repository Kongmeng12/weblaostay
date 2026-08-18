import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { c, f, radius } from '../theme';
import type { Province } from '../lib/types';
import { Button } from './ui';
import { DateRangePicker } from './DateRangePicker';

export interface SearchCriteria {
  q: string;
  provinceId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
}

export function blankCriteria(): SearchCriteria {
  return { q: '', provinceId: '', checkIn: '', checkOut: '', guests: 2 };
}

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

  const { data: provinces } = useQuery({
    queryKey: ['provinces'],
    queryFn: () => api.get<Province[]>('/locations/provinces'),
    staleTime: 60 * 60 * 1000,
  });

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
          onChange={(e) => set('provinceId', e.target.value)}
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

      {/* Takes the whole row: a two-month calendar has nowhere to open inside
          a 150px grid cell, and the arrival and departure belong together. */}
      <div style={{ gridColumn: '1 / -1' }}>
        <DateRangePicker
          checkIn={draft.checkIn}
          checkOut={draft.checkOut}
          onChange={({ checkIn, checkOut }) => setDraft((d) => ({ ...d, checkIn, checkOut }))}
        />
      </div>

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

      <Button type="submit" size="lg" style={{ height: 46 }}>
        ຄົ້ນຫາ
      </Button>
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
  font: f(600, 13.5),
  color: c.text,
  outline: 'none',
};

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', minWidth: 0 }}>
      <span style={{ font: f(700, 11.5), color: c.muted, display: 'block', marginBottom: 6 }}>
        {label}
      </span>
      {children}
    </label>
  );
}
