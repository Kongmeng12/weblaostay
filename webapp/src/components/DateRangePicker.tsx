import { useEffect, useMemo, useRef, useState } from 'react';
import { c, f, radius, shadow, space, TAP, type as t } from '../theme';
import { LAO_MONTHS_LONG, LAO_WEEKDAYS, laoDate, nightsBetween, todayIso } from '../lib/format';

/**
 * Picking a stay, as a calendar.
 *
 * Replaces the pair of `<input type="date">` this used to be. Those are two
 * separate fields that each need the guest to know a number before they can
 * type it — and on desktop Chrome the popup hides behind a small icon most
 * people never find, which left them spinning a segment at a time. A stay is a
 * *range* and a range is chosen by looking at a month, so this shows the month.
 *
 * Both ends live in one control on purpose: the first tap is the arrival, the
 * second is the departure, and the nights between them shade as they are
 * chosen. Two fields cannot show that.
 *
 * `inline` is the default, and it is the whole point — the calendar sits open
 * on the page so a guest sees the month without asking for it. Pass
 * `inline={false}` only where the vertical space genuinely is not there; that
 * form collapses to a field which opens the same calendar in a popover.
 *
 * Everything here is UTC, matching `format.ts` — a `YYYY-MM-DD` is a calendar
 * day, not an instant, and reading one with local getters shows the day before
 * anywhere west of UTC.
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
  /** Shortest stay the calendar will let the second tap land on. */
  minNights?: number;
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Which end the next tap sets.
  const [picking, setPicking] = useState<'in' | 'out'>('in');
  const [hover, setHover] = useState('');
  const today = todayIso();
  const [cursor, setCursor] = useState(() => monthOf(checkIn || today));
  const box = useRef<HTMLDivElement>(null);

  // Only the popover form can be dismissed, and only it needs to listen. An
  // inline calendar has nothing to close and would be attaching document
  // handlers on every page that shows one.
  useEffect(() => {
    if (inline || !open) return;

    const onDown = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
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

  function pick(day: string) {
    // A tap on or before the arrival — or one after a finished range — is read
    // as starting again, which is what someone means when they change their
    // mind about when the stay begins.
    if (picking === 'in' || !checkIn || day <= checkIn) {
      onChange({ checkIn: day, checkOut: '' });
      setPicking('out');
      setHover('');
      return;
    }

    if (nightsBetween(checkIn, day) < minNights) return;

    onChange({ checkIn, checkOut: day });
    setPicking('in');
    setHover('');
    if (!inline) setOpen(false);
  }

  function clear() {
    onChange({ checkIn: '', checkOut: '' });
    setPicking('in');
    setHover('');
  }

  // The second month is rendered always and hidden by CSS under 720px, rather
  // than decided in JS — a resize listener would still be wrong for the first
  // paint.
  const months = useMemo(() => [cursor, nextMonth(cursor)], [cursor]);

  // While choosing the departure the shading follows the pointer, so the guest
  // sees how long the stay is before committing to it.
  const previewEnd = picking === 'out' && !checkOut && hover > checkIn ? hover : checkOut;
  const nights = checkIn && previewEnd ? nightsBetween(checkIn, previewEnd) : 0;

  const summary =
    checkIn && checkOut
      ? `${laoDate(checkIn)} → ${laoDate(checkOut)} · ${nightsBetween(checkIn, checkOut)} ຄືນ`
      : checkIn
        ? `${laoDate(checkIn)} → ເລືອກວັນອອກ`
        : 'ຍັງບໍ່ໄດ້ເລືອກວັນທີ';

  const calendar = (
    <>
      <div style={head}>
        <NavButton label="‹" onClick={() => setCursor(prevMonth(cursor))} disabled={cursor <= monthOf(today)} />
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ font: f(800, 13, 20), color: c.text }}>
            {!checkIn || picking === 'in' ? 'ເລືອກວັນເຂົ້າພັກ' : 'ເລືອກວັນອອກ'}
            {nights > 0 && <span style={{ font: f(600, 12, 18), color: c.muted }}> · {nights} ຄືນ</span>}
          </div>
        </div>
        <NavButton label="›" onClick={() => setCursor(nextMonth(cursor))} />
      </div>

      <div className="laostay-cal-months">
        {months.map((m, i) => (
          <Month
            key={m}
            month={m}
            today={today}
            checkIn={checkIn}
            checkOut={previewEnd}
            minNights={minNights}
            picking={picking}
            onHover={setHover}
            onPick={pick}
            className={i === 1 ? 'laostay-cal-second' : undefined}
          />
        ))}
      </div>

      <div style={foot}>
        <span style={{ font: f(600, 13, 20), color: checkIn ? c.text : c.faint }}>{summary}</span>
        {(checkIn || checkOut) && (
          <button type="button" onClick={clear} style={footButton}>
            ລຶບວັນທີ
          </button>
        )}
      </div>
    </>
  );

  // ── open on the page ───────────────────────────────────────────────────────
  if (inline) {
    return (
      <div style={panel}>{calendar}</div>
    );
  }

  // ── behind a field ─────────────────────────────────────────────────────────
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => {
          if (!open) setCursor(monthOf(checkIn || today));
          setOpen(!open);
        }}
        style={trigger}
      >
        <span style={{ font: f(700, 12, 18), color: c.muted, display: 'block', marginBottom: 2 }}>
          ວັນເຂົ້າພັກ — ວັນອອກ
        </span>
        <span style={{ font: f(600, 13, 20), color: checkIn ? c.text : c.faint }}>{summary}</span>
      </button>

      {open && (
        <div className="laostay-cal-sheet" style={sheet}>
          {calendar}
        </div>
      )}
    </div>
  );
}

function Month({
  month,
  today,
  checkIn,
  checkOut,
  minNights,
  picking,
  onHover,
  onPick,
  className,
}: {
  month: string;
  today: string;
  checkIn: string;
  checkOut: string;
  minNights: number;
  picking: 'in' | 'out';
  onHover: (day: string) => void;
  onPick: (day: string) => void;
  className?: string;
}) {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1;
  const cells = useMemo(() => grid(year, m), [year, m]);

  return (
    <div className={className} style={{ minWidth: 0 }}>
      <div style={{ font: t.label, color: c.text, textAlign: 'center', marginBottom: space[1] }}>
        {LAO_MONTHS_LONG[m]} {year}
      </div>

      <div style={weekRow}>
        {LAO_WEEKDAYS.map((d, i) => (
          <div key={d} style={{ ...weekCell, color: i === 0 || i === 6 ? c.faint : c.muted }}>
            {d}
          </div>
        ))}
      </div>

      <div style={dayGrid}>
        {cells.map((day, i) => {
          if (!day) return <div key={`gap-${i}`} />;

          // A departure closer than the shortest stay is greyed out rather than
          // refused on tap, so the guest can see which days are reachable.
          const tooSoon =
            picking === 'out' && !!checkIn && day > checkIn && nightsBetween(checkIn, day) < minNights;
          const disabled = day < today || tooSoon;

          const isIn = !!checkIn && day === checkIn;
          const isOut = !!checkOut && day === checkOut;
          const inRange = !!checkIn && !!checkOut && day > checkIn && day < checkOut;
          const edge = isIn || isOut;

          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              onMouseEnter={() => onHover(day)}
              onClick={() => onPick(day)}
              style={{
                ...dayCell,
                cursor: disabled ? 'default' : 'pointer',
                background: edge ? c.accent : inRange ? c.accentSoft : 'transparent',
                color: edge ? '#fff' : disabled ? c.faint : inRange ? c.accentDark : c.text,
                font: f(edge ? 800 : 600, 13),
                opacity: disabled ? 0.45 : 1,
                // Square off the inner sides so a range reads as one bar rather
                // than a row of separate pills.
                borderRadius: isIn && checkOut
                  ? '999px 4px 4px 999px'
                  : isOut && checkIn
                    ? '4px 999px 999px 4px'
                    : inRange
                      ? 4
                      : 999,
              }}
            >
              {Number(day.slice(8, 10))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: TAP,
        height: TAP,
        borderRadius: radius.pill,
        border: `1px solid ${c.border}`,
        background: c.surface,
        color: disabled ? c.faint : c.text,
        font: f(700, 16, 24),
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

// ── calendar arithmetic, all UTC ─────────────────────────────────────────────

/** The `YYYY-MM` a day belongs to, used as the cursor. */
function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

function shiftMonth(month: string, by: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + by;
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

const nextMonth = (m: string) => shiftMonth(m, 1);
const prevMonth = (m: string) => shiftMonth(m, -1);

/**
 * One month as 7-column cells, `null` for the blanks before the 1st.
 *
 * `getUTCDay()` returns 0 for Sunday, which is the order `LAO_WEEKDAYS` is
 * already written in — so the lead count is the weekday itself.
 */
function grid(year: number, month: number): (string | null)[] {
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  const mm = String(month + 1).padStart(2, '0');
  for (let d = 1; d <= days; d++) cells.push(`${year}-${mm}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ── styles ───────────────────────────────────────────────────────────────────

const panel: React.CSSProperties = {
  background: c.surface,
  border: `1px solid ${c.border}`,
  borderRadius: radius.md,
  padding: space[3],
};

const trigger: React.CSSProperties = {
  width: '100%',
  minHeight: 46,
  padding: '5px 12px',
  textAlign: 'left',
  background: c.bg,
  border: `1px solid ${c.border}`,
  borderRadius: radius.md,
  cursor: 'pointer',
  outline: 'none',
};

const sheet: React.CSSProperties = {
  position: 'absolute',
  zIndex: 40,
  top: 'calc(100% + 6px)',
  left: 0,
  background: c.surface,
  border: `1px solid ${c.border}`,
  borderRadius: radius.lg,
  boxShadow: shadow.raised,
  padding: 14,
};

const head: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: space[2],
  marginBottom: space[2],
};

const foot: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: space[3],
  marginTop: space[2],
  paddingTop: space[2],
  borderTop: `1px solid ${c.divider}`,
};

const footButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '4px 2px',
  font: f(700, 13, 20),
  color: c.accent,
  cursor: 'pointer',
  flexShrink: 0,
};

const weekRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  marginBottom: 4,
};

const weekCell: React.CSSProperties = {
  textAlign: 'center',
  font: f(700, 12, 18),
  padding: '2px 0',
};

const dayGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 0,
};

const dayCell: React.CSSProperties = {
  // 44 is the floor Apple's HIG and WCAG 2.5.5 both set for a touch target,
  // and a date cell is the smallest thing anyone taps in this app. It costs
  // about 50px of height over the old 36, paid for by the chrome trimmed
  // around the grid rather than by making the days harder to hit.
  height: TAP,
  border: 'none',
  padding: 0,
  outline: 'none',
};
