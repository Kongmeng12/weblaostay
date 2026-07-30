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
