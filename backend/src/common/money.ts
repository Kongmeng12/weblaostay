/**
 * Kip money helpers.
 *
 * Every amount in the database is an `int4` of whole kip — there are no
 * subunits and no decimals. All arithmetic here stays in integer space so a
 * commission split can never drift by a fractional kip.
 *
 * Rates arrive as percentages (5 means 5%, 2.5 means 2.5%) because that is how
 * they are stored in `app_settings` and shown on the Settings screen.
 */

/** Booking source → which commission rate applies. Matches `bookings.source`. */
export const BOOKING_SOURCE = {
  APP: 'app',
  WALK_IN: 'walk_in',
} as const;
export type BookingSource = (typeof BOOKING_SOURCE)[keyof typeof BOOKING_SOURCE];

/** `bookings.status` values shared by all three apps. */
export const BOOKING_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  STAYING: 'staying',
  DONE: 'done',
  CANCELLED: 'cancelled',
} as const;
export type BookingStatus = (typeof BOOKING_STATUS)[keyof typeof BOOKING_STATUS];

/** Statuses that count as real revenue (a cancelled booking earns nothing). */
export const REVENUE_STATUSES: BookingStatus[] = [
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.STAYING,
  BOOKING_STATUS.DONE,
];

export const PARTNER_STATUS = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
} as const;

export const PAYOUT_STATUS = { PENDING: 'pending', PAID: 'paid' } as const;

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  EXPIRED: 'expired',
  REFUNDED: 'refunded',
} as const;

export const USER_STATUS = { ACTIVE: 'active', SUSPENDED: 'suspended' } as const;

export const AVAILABILITY_STATUS = {
  AVAILABLE: 'available',
  BOOKED: 'booked',
  CLOSED: 'closed',
} as const;
export type AvailabilityStatus =
  (typeof AVAILABILITY_STATUS)[keyof typeof AVAILABILITY_STATUS];

/** `promos.type` — how `promos.value` is read. */
export const PROMO_TYPE = { PERCENT: 'percent', FIXED: 'fixed' } as const;
export type PromoType = (typeof PROMO_TYPE)[keyof typeof PROMO_TYPE];

/** `properties.type`, as used by the seed and the customer search filter. */
export const PROPERTY_TYPES = [
  'homestay',
  'guesthouse',
  'hotel',
  'resort',
  'villa',
  'apartment',
] as const;

/** `rooms.bed_type`. */
export const BED_TYPES = ['single', 'double', 'twin', 'king'] as const;

/** `chat_messages.sender_type` — the same three strings as ACTOR. */
export const SENDER_TYPE = { USER: 'user', PARTNER: 'partner', ADMIN: 'admin' } as const;

/**
 * Booking reference shown to guests and partners: the id in hex, so
 * `STL-0142` is booking 322. Kept short enough to read over the phone.
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

/**
 * Discount a promo takes off a subtotal, in whole kip.
 * Never more than the subtotal itself — a fixed-value promo on a cheap stay
 * must not make the total negative.
 */
export function promoDiscount(
  type: string,
  value: number,
  subtotalKip: number,
): number {
  const raw = type === PROMO_TYPE.PERCENT ? percentOf(subtotalKip, value) : Math.round(value);
  return Math.min(Math.max(raw, 0), subtotalKip);
}

/**
 * Apply a percentage rate to a kip amount, rounding to the nearest whole kip.
 *
 * Multiplying before dividing keeps the intermediate value exact for the rates
 * we use (5, 2.5, 30), so `percentOf(1_000_001, 2.5)` is 25000 rather than
 * something ending in .025.
 */
export function percentOf(amountKip: number, ratePercent: number): number {
  return Math.round((amountKip * ratePercent) / 100);
}

/**
 * Split a booking total into what the platform keeps and what the partner gets.
 * `net` is derived by subtraction so the two halves always sum back to `total`.
 */
export function splitCommission(
  totalKip: number,
  ratePercent: number,
): { commission: number; net: number } {
  const commission = percentOf(totalKip, ratePercent);
  return { commission, net: totalKip - commission };
}

/** Commission rate for a booking, picked from its source. */
export function rateForSource(
  source: string | null | undefined,
  appRate: number,
  walkInRate: number,
): number {
  return source === BOOKING_SOURCE.WALK_IN ? walkInRate : appRate;
}

/**
 * Cancellation maths: the platform keeps `feeRate`% and refunds the rest.
 * Refund is derived by subtraction so fee + refund === paid amount exactly.
 */
export function cancellationSplit(
  paidKip: number,
  feeRatePercent: number,
): { fee: number; refund: number } {
  const fee = percentOf(paidKip, feeRatePercent);
  return { fee, refund: paidKip - fee };
}

/** Nights between two dates. Check-out day is not charged. */
export function nightsBetween(checkIn: Date | string, checkOut: Date | string): number {
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  const ms = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
    Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  return Math.max(1, Math.round(ms / 86_400_000));
}

/** `₭1,350,000` — the format used across all three apps. */
export function formatKip(amountKip: number): string {
  return '₭' + Math.round(amountKip).toLocaleString('en-US');
}

/**
 * Percentage change between two periods, for the KPI deltas on the dashboard.
 * Returns null when there is no previous figure to compare against, so the UI
 * can say "—" instead of showing a meaningless +100%.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}
