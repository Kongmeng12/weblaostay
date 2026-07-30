/** Response shapes returned by the admin API. */

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface Kpis {
  revenue: { value: number; deltaPercent: number | null };
  commission: { value: number; deltaPercent: number | null };
  bookings: { value: number; today: number };
  newPartners: { value: number; pendingApprovals: number };
}

export interface GmvSeries {
  days: number;
  peak: number;
  series: { date: string; total: number; heightPercent: number }[];
}

export interface RecentBooking {
  id: string;
  code: string;
  property: string;
  guest: string;
  checkIn: string;
  checkOut: string;
  total: number;
  status: string | null;
}

export interface PayoutSummary {
  pendingTotal: number;
  payoutCount: number;
  partnerCount: number;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface BookingRow {
  id: string;
  code: string;
  property: string;
  propertyId: string;
  province: string;
  guest: string;
  guestPhone: string;
  room: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  subtotal: number;
  fee: number;
  total: number;
  status: string | null;
  source: string | null;
  paymentStatus: string | null;
  createdAt: string | null;
}

export interface CustomerRow {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  tier: string | null;
  points: number | null;
  status: string | null;
  is_verified: boolean | null;
  created_at: string | null;
  trips: number;
  spent: number;
}

export interface PayoutRow {
  id: string;
  partnerId: string;
  partnerName: string;
  ownerName: string;
  bankName: string | null;
  bankAccount: string | null;
  periodStart: string;
  periodEnd: string;
  bookings: number;
  gmv: number;
  commission: number;
  netAmount: number;
  status: string | null;
  paidAt: string | null;
}

export interface PayoutList {
  items: PayoutRow[];
  pendingTotal: number;
  pendingCount: number;
}

export interface ApprovalRow {
  id: string;
  ownerName: string;
  email: string;
  phone: string;
  bankName: string | null;
  appliedAt: string | null;
  status: string | null;
  property: {
    id: string;
    name: string;
    type: string;
    province: string;
    address: string;
  } | null;
  propertyCount: number;
}

export interface PartnerRow {
  id: string;
  ownerName: string;
  email: string;
  phone: string;
  status: string | null;
  commissionRate: string | null;
  bankName: string | null;
  createdAt: string | null;
  propertyName: string;
  province: string | null;
  rating: string | null;
  reviewCount: number;
  propertyCount: number;
  roomCount: number;
  revenue: number;
}

export interface ReviewRow {
  id: string;
  stars: number;
  text: string | null;
  isHidden: boolean | null;
  isFlagged: boolean | null;
  property: string;
  propertyId: string;
  guest: string;
  bookingId: string;
  stayedAt: string;
}

export interface PromoRow {
  id: string;
  code: string;
  type: string;
  value: number;
  usedCount: number;
  bookingCount: number;
  expiresAt: string;
  isActive: boolean | null;
  isExpired: boolean;
}

export interface PlatformSettings {
  platform_name: string;
  contact_email: string;
  commission_rate: number;
  walkin_commission_rate: number;
  cancellation_fee_rate: number;
}

export interface AdminRow {
  id: string;
  email: string;
  name: string;
  role: string;
  roleLabel: string;
  last_login_at: string | null;
}

export interface AuditRow {
  id: string;
  actor_type: string;
  actor_id: string;
  action: string;
  target: string | null;
  ip_address: string | null;
  created_at: string | null;
  actorName: string;
  actorEmail: string | null;
}
