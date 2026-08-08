import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { c, f, radius } from '../theme';
import { addDaysIso, todayIso } from '../lib/format';
import type { Province } from '../lib/types';
import { Button } from './ui';

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

  const set = <K extends keyof SearchCriteria>(key: K, v: SearchCriteria[K]) =>
    setDraft((d) => {
      const next = { ...d, [key]: v };
      // Check-out must follow check-in. Rather than rejecting the guest's tap,
      // push the other end along — that is what they meant.
      if (key === 'checkIn' && next.checkOut && next.checkOut <= (v as string)) {
        next.checkOut = addDaysIso(v as string, 1);
      }
      if (key === 'checkIn' && v && !next.checkOut) {
        next.checkOut = addDaysIso(v as string, 1);
      }
      return next;
    });

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

      <Cell label="ເຂົ້າພັກ">
        <input
          type="date"
          value={draft.checkIn}
          min={todayIso()}
          onChange={(e) => set('checkIn', e.target.value)}
          style={cellInput}
        />
      </Cell>

      <Cell label="ອອກ">
        <input
          type="date"
          value={draft.checkOut}
          min={draft.checkIn ? addDaysIso(draft.checkIn, 1) : addDaysIso(todayIso(), 1)}
          onChange={(e) => set('checkOut', e.target.value)}
          style={cellInput}
        />
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
