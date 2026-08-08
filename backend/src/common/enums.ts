/**
 * The database's enum vocabulary, re-exported for use in DTOs and guards.
 *
 * Prisma generates these from the Postgres types, so importing them here rather
 * than re-declaring string unions means a value the database will reject cannot
 * be spelled in TypeScript either.
 */

export {
  user_role,
  admin_role,
  user_status,
  gender_type,
  otp_purpose,
  business_type,
  partner_status,
  document_type,
  document_status,
  active_status,
  property_type,
  property_status,
  bed_type,
  inventory_status,
  price_type,
  booking_source,
  booking_status,
  guest_type,
  payment_method,
  payment_status,
  refund_status,
  payout_status,
  ledger_entry_type,
  ledger_direction,
  review_status,
  notification_type,
  setting_data_type,
} from '@prisma/client';

import { admin_role, booking_status, user_role } from '@prisma/client';

/** Admin roles allowed to move money. Staff are deliberately excluded. */
export const MONEY_ROLES: admin_role[] = [admin_role.super_admin, admin_role.finance];

export const ALL_ADMIN_ROLES: admin_role[] = [
  admin_role.super_admin,
  admin_role.finance,
  admin_role.staff,
];

/** Human labels for the WebAdmin. */
export const ADMIN_ROLE_LABEL: Record<admin_role, string> = {
  [admin_role.super_admin]: 'Super Admin',
  [admin_role.finance]: 'Finance',
  [admin_role.staff]: 'Staff',
};

export const USER_ROLE_LABEL: Record<user_role, string> = {
  [user_role.CUSTOMER]: 'ລູກຄ້າ',
  [user_role.PARTNER]: 'Partner',
  [user_role.ADMIN]: 'ຜູ້ດູແລ',
};

/** Statuses that count as real revenue — a cancelled stay earns nothing. */
export const REVENUE_STATUSES: booking_status[] = [
  booking_status.confirmed,
  booking_status.staying,
  booking_status.completed,
];

/** Statuses that still occupy inventory. */
export const OCCUPYING_STATUSES: booking_status[] = [
  booking_status.pending,
  booking_status.confirmed,
  booking_status.staying,
  booking_status.completed,
];

/**
 * The one-way ladder a booking climbs. Anything not listed here is refused, so
 * a client cannot walk a completed stay back to `confirmed`.
 *
 * Cancellation is absent on purpose: it moves money and releases inventory, so
 * it goes through its own endpoint rather than a status change.
 */
export const BOOKING_TRANSITIONS: Partial<Record<booking_status, booking_status[]>> = {
  [booking_status.pending]: [booking_status.confirmed],
  [booking_status.confirmed]: [booking_status.staying, booking_status.no_show],
  [booking_status.staying]: [booking_status.completed],
};
