/**
 * Date-only helpers.
 *
 * `check_in`, `check_out`, `period_start`, `room_availability.date` and
 * `promos.expires_at` are PostgreSQL `date` columns — calendar days with no
 * time and no zone. Two traps follow from that:
 *
 *  1. Prisma serialises a JS Date into a `date` column by taking its **UTC**
 *     calendar day. `new Date(2026, 6, 13)` is local midnight, which in UTC+7
 *     is 2026-07-12T17:00Z — so it lands in the database as the 12th.
 *  2. `pg` parses a `date` coming back from a raw query into **local**
 *     midnight, while Prisma hands back UTC midnight. Keying a Map on
 *     `toISOString()` therefore mismatches by a day between the two.
 *
 * Everything here works in UTC so a calendar day survives both directions
 * unchanged, whatever timezone the server runs in.
 */

import { BadRequestException } from '@nestjs/common';

/** Today as UTC midnight. */
export function todayUtc(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

/**
 * Today's calendar day in Laos (UTC+7, no DST), as UTC midnight.
 *
 * A stay's `check_in`/`check_out` are calendar days the guest and the front
 * desk experience in Vientiane time. Comparing them against the *UTC* day
 * would call it yesterday for the first seven hours of every Lao morning —
 * a guest arriving at 06:00 could not be checked in, and a departure would
 * only be closed out seven hours late.
 */
export function todayInLaos(now: Date = new Date()): Date {
  const laos = new Date(now.getTime() + 7 * 3_600_000);
  return new Date(Date.UTC(laos.getUTCFullYear(), laos.getUTCMonth(), laos.getUTCDate()));
}

/** `n` days before today, as UTC midnight. */
export function daysAgoUtc(n: number): Date {
  const d = todayUtc();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

export function addDaysUtc(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/** Monday 00:00 UTC of the week containing `ref`. Payout periods run Mon–Sun. */
export function startOfWeekUtc(ref: Date): Date {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

/** `YYYY-MM-DD` in UTC — the canonical key for a calendar day. */
export function isoDayUtc(date: Date | string): string {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * `2026-08-13` or a Date → UTC midnight of that calendar day.
 *
 * Every `date` column the API accepts goes through this. Building a Date from
 * a bare "2026-08-13" already gives UTC midnight, but a value that arrived with
 * a time or an offset would not, and Prisma writes a `date` column from the
 * *UTC* day of whatever Date it is handed. Normalising here is what stops a
 * stay booked from Vientiane landing a day early.
 *
 * Returns an Invalid Date for unparseable input; callers check `isNaN`.
 */
export function utcMidnight(value: Date | string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return d;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Whole nights between two calendar days. Check-out is not charged. */
export function nightsBetweenUtc(checkIn: Date, checkOut: Date): number {
  return Math.round((utcMidnight(checkOut).getTime() - utcMidnight(checkIn).getTime()) / 86_400_000);
}

/** Every calendar day in `[from, to)` — the nights a stay occupies. */
export function eachNightUtc(from: Date, toExclusive: Date): Date[] {
  const nights: Date[] = [];
  for (let d = utcMidnight(from); d < toExclusive; d = addDaysUtc(d, 1)) {
    nights.push(new Date(d));
  }
  return nights;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Parses a `from`/`to` range shared by every range-filtered endpoint (partner
 * calendar, reports): both ends are calendar days, `to` is exclusive like a
 * stay's check-out, and the span is capped so a mistyped range can't run an
 * unbounded scan.
 */
export function parseDateRange(
  fromIso: string,
  toIso: string,
  maxDays = 366,
): { from: Date; to: Date } {
  const from = utcMidnight(fromIso);
  const to = utcMidnight(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw new BadRequestException('ຊ່ວງວັນທີບໍ່ຖືກຕ້ອງ · Invalid date range');
  }
  if ((to.getTime() - from.getTime()) / 86_400_000 > maxDays) {
    throw new BadRequestException(
      `ຊ່ວງສູງສຸດ ${maxDays} ວັນ · Range may not exceed ${maxDays} days`,
    );
  }
  return { from, to };
}
