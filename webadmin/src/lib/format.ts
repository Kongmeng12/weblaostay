/** Lao month abbreviations, matching the mockups (12–15 ກ.ຄ.). */
const LAO_MONTHS_SHORT = [
  'ມ.ກ.', 'ກ.ພ.', 'ມີ.ນ.', 'ມ.ສ.', 'ພ.ພ.', 'ມິ.ຖ.',
  'ກ.ຄ.', 'ສ.ຫ.', 'ກ.ຍ.', 'ຕ.ລ.', 'ພ.ຈ.', 'ທ.ວ.',
];

/** `₭1,350,000` */
export function kip(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return '₭' + Math.round(amount).toLocaleString('en-US');
}

/** `₭18.4M` / `₭628K` — for KPI cards where space is tight. */
export function kipShort(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const n = Math.round(amount);
  if (Math.abs(n) >= 1_000_000) return '₭' + (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(n) >= 1_000) return '₭' + Math.round(n / 1_000) + 'K';
  return '₭' + n;
}

/**
 * Calendar-day values (check-in, payout period, promo expiry) come from
 * PostgreSQL `date` columns and arrive as UTC midnight, e.g.
 * "2026-07-13T00:00:00.000Z". Reading those with local getters shows the 12th
 * anywhere west of UTC, so date-only values are read in UTC.
 * Real timestamps keep local getters — an admin wants payout time in their own
 * clock, not UTC.
 */
function isDateOnly(value: string | Date): boolean {
  return typeof value === 'string' && /T00:00:00(\.000)?Z$/.test(value);
}

function parts(value: string | Date): { day: number; month: number; year: number } | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return isDateOnly(value)
    ? { day: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear() }
    : { day: d.getDate(), month: d.getMonth(), year: d.getFullYear() };
}

export function laoDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const p = parts(value);
  if (!p) return '—';
  return `${p.day} ${LAO_MONTHS_SHORT[p.month]}`;
}

/** `12–15 ກ.ຄ.`, collapsing the month when both dates share one. */
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

/** "10 ນາທີທີ່ແລ້ວ" style relative time for the audit log. */
export function laoAgo(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'ຫາກໍ່ນີ້';
  if (secs < 3600) return `${Math.floor(secs / 60)} ນາທີທີ່ແລ້ວ`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} ຊົ່ວໂມງທີ່ແລ້ວ`;
  if (secs < 172800) return 'ມື້ວານນີ້';
  if (secs < 2592000) return `${Math.floor(secs / 86400)} ມື້ກ່ອນ`;
  return laoDate(d);
}

/** `▲ 12%` / `▼ 4%` / `—`, with the colour the delta should be drawn in. */
export function deltaLabel(
  percent: number | null | undefined,
  suffix = 'vs ເດືອນກ່ອນ',
): { text: string; color: string } {
  if (percent === null || percent === undefined) {
    return { text: `ບໍ່ມີຂໍ້ມູນປຽບທຽບ`, color: '#8C8073' };
  }
  if (percent === 0) return { text: `ເທົ່າເດີມ ${suffix}`, color: '#8C8073' };
  const up = percent > 0;
  return {
    text: `${up ? '▲' : '▼'} ${Math.abs(percent)}% ${suffix}`,
    color: up ? '#6E7B4E' : '#D13A0E',
  };
}

export function stars(n: number): string {
  return '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(Math.max(0, 5 - n));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1]?.[0] ?? '?').toUpperCase();
}
