/**
 * Admin roles, straight from the design's Settings screen.
 *
 * - super_admin — everything, including managing other admins
 * - finance     — money: payouts, commission settings, refunds
 * - staff       — day-to-day: bookings, customers, approvals, reviews, promos
 */
export const ROLE = {
  SUPER_ADMIN: 'super_admin',
  FINANCE: 'finance',
  STAFF: 'staff',
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];

export const ALL_ROLES: Role[] = [ROLE.SUPER_ADMIN, ROLE.FINANCE, ROLE.STAFF];

/** Roles allowed to move money. Staff are deliberately excluded. */
export const MONEY_ROLES: Role[] = [ROLE.SUPER_ADMIN, ROLE.FINANCE];

/** Human labels for the UI. */
export const ROLE_LABEL: Record<Role, string> = {
  [ROLE.SUPER_ADMIN]: 'Super Admin',
  [ROLE.FINANCE]: 'Finance',
  [ROLE.STAFF]: 'Staff',
};

export function isRole(value: string): value is Role {
  return (ALL_ROLES as string[]).includes(value);
}
