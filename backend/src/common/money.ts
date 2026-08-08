/**
 * Kip money helpers, for schema v2.
 *
 * Every amount in the database is `bigint` of whole kip — there are no subunits
 * and no decimals. Prisma hands those back as JavaScript `bigint`, so all
 * arithmetic here stays in bigint space and a commission split can never drift
 * by a fractional kip.
 *
 * **Money leaves the API as a `number`, not a string.** The BigInt interceptor
 * turns every bigint into a string so ids survive JSON, but doing that to money
 * would hand clients `"1350000"` where they expect `1350000`. View mappers
 * therefore call `kipOf()` on the way out. That is safe: `Number.MAX_SAFE_INTEGER`
 * is ₭9,007,199,254,740,992 — nine quadrillion kip, which no total will reach.
 *
 * Rates arrive as percentages (5 means 5%, 2.5 means 2.5%) because that is how
 * `system_settings` and `partners.*_commission_rate` store them.
 */

import { Prisma } from '@prisma/client';

/** The largest kip amount that survives the trip through JSON as a number. */
const MAX_SAFE_KIP = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * bigint → number, for sending money to a client.
 *
 * Throws rather than silently truncating: a wrong number on an invoice is worse
 * than an error, and reaching this ceiling means something upstream is broken
 * (a rate applied twice, a currency mixed in) long before it means the platform
 * really turned over nine quadrillion kip.
 */
export function kipOf(amount: bigint | number | null | undefined): number {
  if (amount === null || amount === undefined) return 0;
  if (typeof amount === 'number') return Math.round(amount);
  if (amount > MAX_SAFE_KIP || amount < -MAX_SAFE_KIP) {
    throw new RangeError(`Kip amount ${amount} is too large to serialise as a number`);
  }
  return Number(amount);
}

/** Same, but keeps null as null — for optional columns like `paid_amount`. */
export function kipOrNull(amount: bigint | null | undefined): number | null {
  return amount === null || amount === undefined ? null : kipOf(amount);
}

/** Anything numeric the API or a DTO hands us → bigint kip. */
export function toKip(value: bigint | number | string | Prisma.Decimal): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.round(value));
  if (typeof value === 'string') return BigInt(Math.round(Number(value)));
  return BigInt(value.round().toString());
}

/**
 * Apply a percentage rate to a kip amount, rounding to the nearest whole kip.
 *
 * The rate is scaled to an integer first and the multiply happens before the
 * divide, so the intermediate value stays exact in bigint space — no float ever
 * touches a money figure. Rates carry at most two decimals (5, 2.5, 30.25),
 * which is what `decimal(5,2)` stores.
 */
export function percentOf(amountKip: bigint, ratePercent: number | Prisma.Decimal): bigint {
  const rate = typeof ratePercent === 'number' ? ratePercent : Number(ratePercent.toString());
  // 5 → 500, 2.5 → 250. Rounded because 2.5 * 100 can land on 249.99999 in float.
  const scaled = BigInt(Math.round(rate * 100));
  const numerator = amountKip * scaled;
  const denominator = 10_000n;

  // Round half away from zero, matching what a person doing this by hand expects.
  const half = denominator / 2n;
  return numerator >= 0n
    ? (numerator + half) / denominator
    : -((-numerator + half) / denominator);
}

/**
 * Split a total into what the platform keeps and what the partner receives.
 * `net` is derived by subtraction so the two halves always sum back to `total`,
 * which is the identity `payouts.gross_amount = commission_amount + net_amount`
 * is checked against in the database.
 */
export function splitCommission(
  totalKip: bigint,
  ratePercent: number | Prisma.Decimal,
): { commission: bigint; net: bigint } {
  const commission = percentOf(totalKip, ratePercent);
  return { commission, net: totalKip - commission };
}

/**
 * Cancellation maths: the property keeps `penaltyPercent`% and the rest is
 * refunded. Refund is derived by subtraction so penalty + refund === paid,
 * exactly.
 */
export function cancellationSplit(
  paidKip: bigint,
  penaltyPercent: number | Prisma.Decimal,
): { penalty: bigint; refund: bigint } {
  const penalty = percentOf(paidKip, penaltyPercent);
  return { penalty, refund: paidKip - penalty };
}

/** `₭1,350,000` — the format used across all three apps. */
export function formatKip(amount: bigint | number): string {
  return '₭' + kipOf(amount).toLocaleString('en-US');
}

/**
 * Booking reference shown to guests and partners: the id in hex, so
 * `STL-0142` is booking 322. Short enough to read over the phone.
 */
export function bookingCode(id: bigint): string {
  return 'STL-' + id.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Resolves a search term to candidate booking ids.
 *
 * `bookingCode` renders the id in hex, so "STL-0142" means id 322 — but a hex
 * code can be all digits, which is indistinguishable from someone pasting a raw
 * id. Rather than guess, both readings are returned and matched with `IN`:
 *
 *   "STL-0142" → [322]        (prefixed: unambiguously hex)
 *   "142"      → [322, 142]   (bare: could be either)
 *   "2A83"     → [10883]      (has hex letters: only one reading)
 */
export function parseBookingRef(input: string): bigint[] {
  const trimmed = input.trim().toUpperCase();
  const hadPrefix = trimmed.startsWith('STL-');
  const cleaned = hadPrefix ? trimmed.slice(4) : trimmed;

  if (!/^[0-9A-F]+$/.test(cleaned) || cleaned.length > 15) return [];

  const candidates: bigint[] = [];
  try {
    candidates.push(BigInt('0x' + cleaned));
  } catch {
    /* not parseable as hex */
  }
  if (!hadPrefix && /^\d+$/.test(cleaned)) {
    try {
      const asDecimal = BigInt(cleaned);
      if (!candidates.includes(asDecimal)) candidates.push(asDecimal);
    } catch {
      /* not parseable as decimal */
    }
  }
  return candidates;
}

/** Nights between two calendar days. The check-out day is not charged. */
export function nightsBetween(checkIn: Date, checkOut: Date): number {
  const a = Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate());
  const b = Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate());
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

/**
 * Percentage change between two periods, for the KPI deltas on a dashboard.
 * Null when there is no previous figure to compare against, so the UI can say
 * "—" instead of a meaningless +100%.
 */
export function percentChange(current: bigint, previous: bigint): number | null {
  if (previous === 0n) return current === 0n ? 0 : null;
  const delta = Number(current - previous);
  return Math.round((delta / Number(previous)) * 100);
}

/** `Decimal(5,2)` → a plain number, for rates in responses. */
export function rateOf(value: Prisma.Decimal | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value.toString());
}
