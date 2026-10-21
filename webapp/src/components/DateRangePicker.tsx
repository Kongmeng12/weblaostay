import { useEffect, useMemo, useRef, useState } from 'react';
import { c, f, radius, shadow, space, type as t } from '../theme';
import { LAO_MONTHS_LONG, LAO_WEEKDAYS, laoDate, nightsBetween, todayIso } from '../lib/format';

/**
 * Picking a stay — the customer app's calendar (`_Calendar` in
 * `customer_app/lib/screens/booking/reserve_screen.dart`), on the web.
 *
 * One month at a time with ‹ › to page, weeks starting on Monday, square day
 * cells, and the whole stay filled in solid orange so its length reads at a
 * glance. Today is outlined; past days are faded and cannot be tapped.
 *
 * The first tap is the arrival and is held **here**, not handed to the page:
 * "ເລືອກວັນອອກ" shows under the month until the second tap names the
 * departure, and only then does `onChange` fire with both ends. A tap on or
 * before the pending arrival starts again from that day. Keeping the half-done
 * range local is what the app does too — the page never re-prices for a
 * one-sided range, and nothing it does while re-pricing can lose the first tap.
 *
 * `inline` (the default) shows the month on the page. `inline={false}`
 * collapses it to a field that opens the same calendar in a popover, for
 * forms where the vertical space is not there.
 *
 * Everything is UTC, matching `format.ts` — a `YYYY-MM-DD` is a calendar day,
 * not an instant, and local getters would show the day before west of UTC.
 */
export function DateRangePicker({
  checkIn,
  checkOut,
  onChange,
  minNights = 1,
  inline = true,
}: {
  checkIn: string;
  checkOut: string;
  onChange: (next: { checkIn: string; checkOut: string }) => void;
  /** Shortest stay the second tap may land on. */
  minNights?: number;
  inline?: boolean;
}) {
  const today = todayIso();
  const [open, setOpen] = useState(false);
  /** The arrival tapped while the departure is still to come. */
  const [pending, setPending] = useState('');
  const [hover, setHover] = useState('');
  const [cursor, setCursor] = useState(() => monthOf(checkIn || today));
  const box = useRef<HTMLDivElement>(null);

  // Only the popover can be dismissed, and only it needs document listeners.
  useEffect(() => {
    if (inline || !open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [inline, open]);

  function close() {
    setOpen(false);
    setPending('');
    setHover('');
  }

  function pick(day: string) {
    if (!pending || day <= pending) {
      setPending(day);
      setHover('');
      return;
    }
    if (nightsBetween(pending, day) < minNights) return;
    onChange({ checkIn: pending, checkOut: day });
    setPending('');
    setHover('');
    if (!inline) setOpen(false);
  }

  function clear() {
    setPending('');
    setHover('');
    onChange({ checkIn: '', checkOut: '' });
  }

  // What is drawn: the half-picked range (shading follows the pointer on a
  // desktop) while picking, otherwise the stay the page holds.
  const from = pending || checkIn;
  const to = pending ? (hover > pending ? hover : pending) : checkOut;
  const nights = from && to && to > from ? nightsBetween(from, to) : 0;

  const summary =
    checkIn && checkOut
      ? `${laoDate(checkIn)} → ${laoDate(checkOut)} · ${nightsBetween(checkIn, checkOut)} ຄືນ`
      : 'ຍັງບໍ່ໄດ້ເລືອກວັນທີ';

  const year = Number(cursor.slice(0, 4));
  const month = Number(cursor.slice(5, 7)) - 1;
  const cells = useMemo(() => grid(year, month), [year, month]);
  const atFirstMonth = cursor <= monthOf(today);

  const calendar = (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <NavButton label="ເດືອນກ່ອນ" glyph="‹" disabled={atFirstMonth} onClick={() => setCursor(shiftMonth(cursor, -1))} />
        <div style={{ font: f(700, 14, 22), color: c.text }}>
          {LAO_MONTHS_LONG[month]} {year}
        </div>
        <NavButton label="ເດືອນຖັດໄປ" glyph="›" onClick={() => setCursor(shiftMonth(cursor, 1))} />
      </div>

      <div style={sevenColumns}>
        {WEEKDAYS_MON_FIRST.map((d) => (
          <div key={d} style={{ textAlign: 'center', font: f(600, 11, 18), color: c.muted }}>
            {d}
          </div>
        ))}
      </div>

      <div style={{ ...sevenColumns, marginTop: 6 }} onMouseLeave={() => setHover('')}>
        {cells.map((day, i) => {
          if (!day) return <div key={`gap-${i}`} />;

          const past = day < today;
          // While choosing the departure, days nearer than the shortest stay are
          // faded too, so the guest sees which ones the second tap can reach.
          const tooSoon = !!pending && day > pending && nightsBetween(pending, day) < minNights;
          const disabled = past || tooSoon;
          const inRange = !!from && !!to && day >= from && day <= to && !past;
          const isToday = day === today;

          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              aria-pressed={inRange}
              aria-label={laoDate(day)}
              onMouseEnter={() => pending && setHover(day)}
              onClick={() => pick(day)}
              style={{
                aspectRatio: '1 / 1',
                width: '100%',
                padding: 0,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 10,
                border: isToday && !inRange ? `1.2px solid ${c.accent}` : '1.2px solid transparent',
                background: inRange ? c.accent : 'transparent',
                color: inRange ? '#fff' : disabled ? c.faint : c.text,
                font: f(600, 13, 18),
                cursor: disabled ? 'default' : 'pointer',
                opacity: tooSoon && !past ? 0.5 : 1,
              }}
            >
              {Number(day.slice(8, 10))}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space[3],
          marginTop: 10,
          minHeight: 24,
        }}
      >
        <span style={{ font: t.caption, color: pending ? c.accentDark : c.muted }}>
          {pending
            ? `ເລືອກວັນອອກ${nights ? ` · ${nights} ຄືນ` : ''}`
            : checkIn && checkOut
              ? summary
              : 'ແຕະວັນເຂົ້າພັກ ແລ້ວແຕະວັນອອກ'}
        </span>
        {(checkIn || checkOut || pending) && (
          <button type="button" onClick={clear} style={linkButton}>
            ລຶບວັນທີ
          </button>
        )}
      </div>
    </div>
  );

  if (inline) return calendar;

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (open) return close();
          setCursor(monthOf(checkIn || today));
          setOpen(true);
        }}
        style={{
          width: '100%',
          minHeight: 48,
          padding: '6px 14px',
          textAlign: 'left',
          background: c.bg,
          border: '1px solid transparent',
          borderRadius: radius.md,
          cursor: 'pointer',
        }}
      >
        <span style={{ font: f(700, 11.5, 18), color: c.muted, display: 'block' }}>ວັນເຂົ້າພັກ — ວັນອອກ</span>
        <span style={{ font: f(600, 13.5, 20), color: checkIn ? c.text : c.faint }}>{summary}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            zIndex: 40,
            top: 'calc(100% + 6px)',
            left: 0,
            width: 'min(340px, calc(100vw - 36px))',
            background: c.surface,
            border: `1px solid ${c.border}`,
            borderRadius: radius.lg,
            boxShadow: shadow.raised,
            padding: 16,
          }}
        >
          {calendar}
        </div>
      )}
    </div>
  );
}

/** The app's month arrows: a small ring, faded when it cannot go back. */
function NavButton({
  label,
  glyph,
  onClick,
  disabled,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        border: `1px solid ${disabled ? c.divider : c.border}`,
        background: 'transparent',
        color: disabled ? c.faint : c.text,
        font: f(700, 18, 20),
        cursor: disabled ? 'default' : 'pointer',
        display: 'grid',
        placeItems: 'center',
        padding: 0,
      }}
    >
      {glyph}
    </button>
  );
}

// ── calendar arithmetic, all UTC ─────────────────────────────────────────────

/** Monday first, as the app draws its weeks. `LAO_WEEKDAYS` starts on Sunday. */
const WEEKDAYS_MON_FIRST = [...LAO_WEEKDAYS.slice(1), LAO_WEEKDAYS[0]];

function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

function shiftMonth(month: string, by: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + by;
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

/** One month as 7-column cells (Monday first), `null` for the blanks. */
function grid(year: number, month: number): (string | null)[] {
  // getUTCDay: 0 = Sunday … 6 = Saturday; Monday-first puts Sunday last.
  const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  const mm = String(month + 1).padStart(2, '0');
  for (let d = 1; d <= days; d++) cells.push(`${year}-${mm}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ── styles ───────────────────────────────────────────────────────────────────

const sevenColumns: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  gap: 6,
};

const linkButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '4px 2px',
  font: f(700, 13, 20),
  color: c.accent,
  cursor: 'pointer',
  flexShrink: 0,
};
