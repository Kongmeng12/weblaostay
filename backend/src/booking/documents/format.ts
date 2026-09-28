/**
 * Dates for documents that leave the app. English month and day names are
 * spelled out here rather than taken from `Intl` 'en-GB', whose short
 * September changed from "Sep" to "Sept" between ICU versions — a document
 * should read the same whichever Node renders it.
 */

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Laos keeps UTC+07:00 all year — no daylight saving to account for. */
const LAOS_OFFSET_MS = 7 * 60 * 60 * 1000;

/** "Mon, 12 Oct 2026" for a date-only value stored as UTC midnight. */
export function enDate(d: Date): string {
  return `${EN_DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${EN_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "ຈັນ, 12 ຕຸລາ 2026" for a date-only value stored as UTC midnight. */
export function loDate(d: Date): string {
  return new Intl.DateTimeFormat('lo-LA', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** "28 Sep 2026, 10:15 (UTC+07:00)" — a real instant, on Laos's clock. */
export function laosInstant(d: Date): string {
  const t = new Date(d.getTime() + LAOS_OFFSET_MS);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${t.getUTCDate()} ${EN_MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}, ${hh}:${mm} (UTC+07:00)`;
}
