/** Lao month abbreviations. */
const LAO_MONTHS_SHORT = [
  'ມ.ກ.', 'ກ.ພ.', 'ມີ.ນ.', 'ມ.ສ.', 'ພ.ພ.', 'ມິ.ຖ.',
  'ກ.ຄ.', 'ສ.ຫ.', 'ກ.ຍ.', 'ຕ.ລ.', 'ພ.ຈ.', 'ທ.ວ.',
];

const LAO_MONTHS_LONG = [
  'ມັງກອນ', 'ກຸມພາ', 'ມີນາ', 'ເມສາ', 'ພຶດສະພາ', 'ມິຖຸນາ',
  'ກໍລະກົດ', 'ສິງຫາ', 'ກັນຍາ', 'ຕຸລາ', 'ພະຈິກ', 'ທັນວາ',
];

const LAO_WEEKDAYS = ['ອາ', 'ຈ', 'ອ', 'ພ', 'ພຫ', 'ສຸ', 'ສ'];

/** `₭1,350,000` */
export function kip(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return '₭' + Math.round(amount).toLocaleString('en-US');
}

/** `₭18.4M` / `₭628K` — where space is tight. */
export function kipShort(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const n = Math.round(amount);
  if (Math.abs(n) >= 1_000_000) return '₭' + (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(n) >= 1_000) return '₭' + Math.round(n / 1_000) + 'K';
  return '₭' + n;
}

/**
 * Calendar-day values — check-in, check-out, a night on the calendar — come
 * from PostgreSQL `date` columns and arrive as UTC midnight, e.g.
 * `2026-08-13T00:00:00.000Z`. Reading those with local getters shows the 12th
 * anywhere west of UTC, which would tell a guest they are arriving a day early.
 *
 * Real timestamps (paid_at, created_at) keep local getters — a guest wants the
 * time on their own clock.
 */
function isDateOnly(value: string | Date): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}($|T00:00:00(\.000)?Z$)/.test(value);
}

function parts(
  value: string | Date,
): { day: number; month: number; year: number; weekday: number } | null {
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);
  if (Number.isNaN(d.getTime())) return null;

  return isDateOnly(value)
    ? {
        day: d.getUTCDate(),
        month: d.getUTCMonth(),
        year: d.getUTCFullYear(),
        weekday: d.getUTCDay(),
      }
    : { day: d.getDate(), month: d.getMonth(), year: d.getFullYear(), weekday: d.getDay() };
}

/** `13 ສ.ຫ.` */
export function laoDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const p = parts(value);
  return p ? `${p.day} ${LAO_MONTHS_SHORT[p.month]}` : '—';
}

/** `13 ສິງຫາ 2026` — for a booking confirmation, where clarity beats brevity. */
export function laoDateFull(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const p = parts(value);
  return p ? `${LAO_WEEKDAYS[p.weekday]} · ${p.day} ${LAO_MONTHS_LONG[p.month]} ${p.year}` : '—';
}

/** `12–15 ກ.ຄ.`, collapsing the month when both ends share it. */
export function laoDateRange(
  from: string | Date | null | undefined,
  to: string | Date | null | undefined,
): string {
  if (!from || !to) return '—';
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return '—';
  if (a.month === b.month && a.year === b.year) {
    return `${a.day}–${b.day} ${LAO_MONTHS_SHORT[a.month]}`;
  }
  return `${laoDate(from)} – ${laoDate(to)}`;
}

export function laoDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${LAO_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()} · ${hh}:${mm}`;
}

/** `14:30` — the time alone, for a chat bubble where the day is already clear
 *  from where the message sits in the thread. */
export function laoTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function laoAgo(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'ຫາກໍ່ນີ້';
  if (secs < 3600) return `${Math.floor(secs / 60)} ນາທີກ່ອນ`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} ຊົ່ວໂມງກ່ອນ`;
  if (secs < 172800) return 'ມື້ວານນີ້';
  if (secs < 2592000) return `${Math.floor(secs / 86400)} ມື້ກ່ອນ`;
  return laoDate(d);
}

export function stars(n: number): string {
  const whole = Math.round(n);
  return '★'.repeat(Math.max(0, Math.min(5, whole))) + '☆'.repeat(Math.max(0, 5 - whole));
}

export function initials(name: string): string {
  const bits = name.trim().split(/\s+/);
  return (bits[bits.length - 1]?.[0] ?? '?').toUpperCase();
}

// ── the `YYYY-MM-DD` form every date query parameter takes ───────────────────

/** Today as a UTC calendar day. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole nights between two `YYYY-MM-DD` days. Check-out is not charged. */
export function nightsBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00.000Z`).getTime();
  const b = new Date(`${to}T00:00:00.000Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** `mm:ss` left on a hold, or null once it has lapsed. */
export function countdown(until: string | null | undefined): string | null {
  if (!until) return null;
  const ms = new Date(until).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
