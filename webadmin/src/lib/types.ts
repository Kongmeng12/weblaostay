/**
 * Response shapes returned by the admin API.
 *
 * Two conventions worth knowing, both from the v2 backend:
 *
 * - **Ids are strings.** They are `bigint` in Postgres, and JSON numbers cannot
 *   hold one safely, so they arrive serialised. Never do arithmetic on them.
 * - **Money is a whole number of kip.** No decimals, no minor unit — ₭320,000
 *   is `320000`. Format with `formatKip`, never `toFixed`.
 */

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// ── dashboard ────────────────────────────────────────────────────────────────

export interface Dashboard {
  /** Gross merchandise value: everything confirmed, staying or completed. */
  gmv: number;
  commission: number;
  bookings: number;
  bookingsByStatus: Record<string, number>;
  pendingApprovals: number;
  activeProperties: number;
  pendingPayouts: { count: number; amount: number };
}

export interface GmvSeries {
  days: number;
  peak: number;
  total: number;
  series: { date: string; total: number; bookings: number; heightPercent: number }[];
}

// ── bookings ─────────────────────────────────────────────────────────────────

export interface BookingRow {
  id: string;
  code: string;
  property: string;
  guest: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  total: number;
  commission: number;
  status: string;
  source: string;
  paymentStatus: string | null;
  createdAt: string | null;
}

/** `GET /admin/bookings/:id` — the full record behind a row. */
export interface BookingDetail {
  id: string;
  code: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  subtotal: number;
  discount: number;
  tax: number;
  serviceFee: number;
  cleaningFee: number;
  total: number;
  commissionRate: number;
  commission: number;
  payout: number;
  status: string;
  source: string;
  holdExpiresAt: string | null;
  specialRequest: string | null;
  createdAt: string | null;
  property: {
    id: string;
    name: string;
    province: string | null;
    district: string | null;
    address: string | null;
    phone: string | null;
    host: string;
  };
  roomType: { id: string; name: string; quantity: number; pricePerNight: number } | null;
  guest: { name: string | null; email: string; phone: string | null };
  payments: { id: string; method: string; amount: number; status: string; paidAt: string | null }[];
}

// ── customers ────────────────────────────────────────────────────────────────

export interface CustomerRow {
  id: string;
  email: string;
  phone: string | null;
  fullName: string | null;
  tier: string;
  points: number;
  status: string;
  isVerified: boolean;
  bookings: number;
  /** Lifetime spend across confirmed, staying and completed bookings. */
  spent: number;
  createdAt: string | null;
}

export interface CustomerSummary {
  total: number;
  active: number;
  suspended: number;
}

// ── partners & approvals ─────────────────────────────────────────────────────

export interface PartnerRow {
  id: string;
  businessName: string;
  ownerName: string | null;
  email: string;
  phone: string | null;
  status: string;
  /** Percentage, e.g. 5 for 5%. */
  commissionRate: number;
  propertyCount: number;
  payoutCount: number;
  roomCount: number;
  /** Every province they operate in, deduplicated. */
  provinces: string[];
  /** Weighted across their properties; null when nobody has reviewed them. */
  rating: number | null;
  reviewCount: number;
  revenue: number;
  createdAt: string | null;
}

export interface ProvinceCount {
  id: number | null;
  province: string;
  count: number;
}

/**
 * A pending application. One partner may have applied with several properties,
 * which is why `properties` is a list rather than the single one v1 assumed.
 */
export interface ApprovalRow {
  id: string;
  businessName: string;
  ownerName: string | null;
  email: string;
  phone: string | null;
  appliedAt: string | null;
  documents: { id: string; type: string; url: string; status: string }[];
  properties: {
    id: string;
    name: string;
    type: string;
    province: string | null;
    address: string | null;
  }[];
}

// ── payouts ──────────────────────────────────────────────────────────────────

export interface PayoutRow {
  id: string;
  partnerId: string;
  partnerName: string;
  ownerName: string | null;
  bankName: string | null;
  bankAccount: string | null;
  periodStart: string;
  periodEnd: string;
  gross: number;
  commission: number;
  net: number;
  status: string;
  paidAt: string | null;
  bookings: number;
}

/** `GET /admin/payouts` — not paginated; a period is a few dozen rows at most. */
export interface PayoutList {
  items: PayoutRow[];
  pendingCount: number;
  pendingTotal: number;
}

export interface PayoutDetail {
  id: string;
  gross: number;
  commission: number;
  net: number;
  items: {
    bookingId: string;
    code: string;
    checkIn: string;
    checkOut: string;
    source: string;
    gross: number;
    commission: number;
    net: number;
  }[];
}

// ── reviews ──────────────────────────────────────────────────────────────────

export interface ReviewRow {
  id: string;
  stars: number;
  title: string | null;
  comment: string | null;
  property: string;
  guest: string;
  status: string;
  reports: number;
  createdAt: string | null;
}

// ── settings & audit ─────────────────────────────────────────────────────────

/**
 * `system_settings`, parsed. Rates are percentages (5 means 5%), durations are
 * whole minutes.
 */
export interface SystemSettings {
  commission_rate_app: number;
  commission_rate_walkin: number;
  service_fee_rate: number;
  tax_rate: number;
  hold_ttl_minutes: number;
  max_nights_per_booking: number;
  default_min_nights: number;
  payment_provider: string;
  qr_ttl_minutes: number;
  payout_period_days: number;
  otp_ttl_minutes: number;
  otp_max_attempts: number;
  password_reset_ttl_minutes: number;
  login_max_attempts: number;
  login_lockout_minutes: number;
  access_token_ttl: string;
  refresh_token_ttl: string;
  max_image_mb: number;
  max_images_per_property: number;
}

/** Only the subset `PATCH /admin/settings` will accept. */
export type EditableSettings = Pick<
  SystemSettings,
  | 'commission_rate_app'
  | 'commission_rate_walkin'
  | 'service_fee_rate'
  | 'tax_rate'
  | 'hold_ttl_minutes'
  | 'max_nights_per_booking'
  | 'qr_ttl_minutes'
  | 'payout_period_days'
  | 'login_max_attempts'
  | 'login_lockout_minutes'
>;

export interface SettingsResponse {
  system: SystemSettings;
  /** Free-form branding and contact strings from `app_settings`. */
  app: Record<string, string>;
}

export interface AdminRow {
  id: string;
  email: string;
  fullName: string | null;
  adminRole: string | null;
  lastLoginAt: string | null;
  status: string;
}

export interface AuditRow {
  id: string;
  action: string;
  module: string | null;
  table: string | null;
  recordId: string | null;
  /** Falls back to "ລະບົບ" for the sweeper and the payout generator. */
  actor: string;
  ip: string | null;
  createdAt: string | null;
}
