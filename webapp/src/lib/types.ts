/**
 * Response shapes from the guest-facing API.
 *
 * Two conventions inherited from the backend:
 *
 * - **Ids are strings.** They are `bigint` in Postgres and a JSON number cannot
 *   hold one safely, so they arrive serialised. Never do arithmetic on them.
 * - **Money is a whole number of kip.** ₭320,000 is `320000` — no decimals, no
 *   minor unit. Format with `kip()`, never `toFixed`.
 */

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// ── search ───────────────────────────────────────────────────────────────────

/** One card in the search results. */
export interface PropertyListing {
  id: string;
  name: string;
  type: string;
  province: string | null;
  district: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number;
  reviewCount: number;
  coverImage: string | null;
  fromPricePerNight: number;
  /** Null unless the search carried dates. */
  staySubtotal: number | null;
  nights: number | null;
  availableRoomTypes: number;
  /** Null unless the search carried lat/lng. */
  distanceKm: number | null;
}

export interface SearchResult {
  items: PropertyListing[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface Province {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  propertyCount: number;
}

export interface Amenity {
  id: string;
  name: string;
  nameEn: string;
  icon: string | null;
  category: string | null;
}

// ── property page ────────────────────────────────────────────────────────────

export interface RoomOffer {
  id: string;
  name: string;
  description: string | null;
  bedType: string;
  hasAc: boolean;
  maxOccupancy: number;
  extraGuestFee: number;
  sizeSqm: number | null;
  basePrice: number;
  totalRooms: number;
  minNights: number;
  images: string[];
  /** The whole stay at this room's nightly rates. Null without dates. */
  stayTotal: number | null;
  /** Null without dates; false when some night of the range is sold out. */
  available: boolean | null;
}

export interface PropertyDetail {
  id: string;
  name: string;
  type: string;
  description: string | null;
  phone: string | null;
  province: string | null;
  district: string | null;
  village: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number;
  reviewCount: number;
  images: { url: string; caption: string | null; isCover: boolean }[];
  amenities: Amenity[];
  rules: {
    checkInFrom: string | null;
    checkOutUntil: string | null;
    smokingAllowed: boolean;
    petAllowed: boolean;
    childAllowed: boolean;
    partyAllowed: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    note: string | null;
  } | null;
  cancellationPolicy: {
    name: string;
    daysBeforeCheckin: number;
    penaltyPercent: number;
    isRefundable: boolean;
    description: string | null;
  } | null;
  host: { id: string; name: string };
  nights: number | null;
  roomTypes: RoomOffer[];
  reviews: {
    id: string;
    stars: number;
    title: string | null;
    comment: string | null;
    guest: string;
    createdAt: string | null;
  }[];
}

/** `GET /properties/:id/calendar` — one entry per night, gaps filled. */
export interface PropertyCalendar {
  propertyId: string;
  roomTypes: {
    id: string;
    name: string;
    totalRooms: number;
    days: { date: string; price: number; available: number; open: boolean }[];
  }[];
}

// ── booking ──────────────────────────────────────────────────────────────────

/** `POST /customer/bookings/quote` — priced, nothing written. */
export interface Quote {
  roomTypeId: string;
  propertyId: string;
  nights: number;
  quantity: number;
  perNight: { date: string; price: number }[];
  subtotal: number;
  serviceFee: number;
  tax: number;
  cleaningFee: number;
  discount: number;
  total: number;
}

export interface BookingRow {
  id: string;
  code: string;
  propertyId: string;
  property: string;
  province: string | null;
  photo: string | null;
  roomType: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  total: number;
  status: string;
  /** When a `pending` hold lapses. The sweeper cancels it at that moment. */
  holdExpiresAt: string | null;
  paymentId: string | null;
  paymentStatus: string | null;
  reviewed: boolean;
}

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
  payments: {
    id: string;
    amount: number;
    status: string;
    paidAt: string | null;
    expiresAt: string | null;
  }[];
  /**
   * What was actually captured — the server's own sum, not something to work
   * out from `payments`. Once a booking is refunded no payment row still reads
   * `paid`, so summing them client-side would report zero for a stay that was
   * very much paid for.
   */
  paidAmount: number;
  refunds: {
    id: string;
    amount: number;
    status: string;
    reason: string | null;
    refundedAt: string | null;
  }[];
  cancellation: {
    reason: string | null;
    penalty: number;
    refund: number;
    cancelledAt: string | null;
  } | null;
}

/** `POST /customer/bookings/:id/pay` and `GET /customer/payments/:id`. */
export interface Payment {
  id: string;
  bookingId: string;
  method: string;
  /** The EMVCo string to render as a QR code. */
  qrPayload: string | null;
  /**
   * A link straight into the payer's banking app. Only returned by the call
   * that creates the charge — a poll of `GET /customer/payments/:id` has null.
   */
  deepLink?: string | null;
  amount: number;
  status: string;
  paidAt: string | null;
  expiresAt: string | null;
  txnRef: string | null;
  /** Only on the polling endpoint. */
  bookingStatus?: string;
}

export interface CancelResult {
  bookingId: string;
  status: string;
  paid: number;
  penalty: number;
  refund: number;
}

// ── chat ─────────────────────────────────────────────────────────────────────

/**
 * One thread with a property.
 *
 * A conversation belongs to a property, not a booking — `bookingId` is optional
 * because asking a question before booking is exactly the conversation worth
 * having. Only a guest may open one.
 */
export interface Conversation {
  id: string;
  propertyId: string;
  property: string;
  counterpartName: string;
  bookingId: string | null;
  bookingCode: string | null;
  status: string;
  /** Null when the newest message was deleted; the row stays, the text goes. */
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastMessageMine: boolean;
  unread: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  mine: boolean;
  type: string;
  text: string | null;
  isDeleted: boolean;
  isEdited: boolean;
  replyToId: string | null;
  createdAt: string | null;
}

// ── CMS ──────────────────────────────────────────────────────────────────────

export interface HomeContent {
  banners: {
    id: string;
    title: string;
    description: string | null;
    imageUrl: string | null;
    targetType: 'property' | 'promotion' | 'url' | null;
    targetId: string | null;
    order: number;
    startDate: string | null;
    endDate: string | null;
    isActive: boolean;
  }[];
  announcements: {
    id: string;
    title: string;
    content: string | null;
    startDate: string | null;
    endDate: string | null;
  }[];
}

export interface FaqGroup {
  category: string;
  items: { id: string; question: string; answer: string }[];
}

export interface AppPage {
  slug: string;
  title: string;
  content: string | null;
  updatedAt: string | null;
}

// ── reviews ──────────────────────────────────────────────────────────────────

export interface ReplyNode {
  id: string;
  text: string;
  author: string;
  authorId: string;
  createdAt: string | null;
  children: ReplyNode[];
}

export interface ReviewThread {
  id: string;
  propertyId: string;
  property: string;
  stars: number;
  title: string | null;
  comment: string | null;
  guest: string;
  status: string;
  createdAt: string | null;
  images: { id: string; url: string; order: number }[];
  replies: ReplyNode[];
}

// ── account ──────────────────────────────────────────────────────────────────

export interface CustomerProfile {
  id: string;
  email: string;
  phone: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  tier: string;
  points: number;
  isVerified: boolean;
  bookings: { total: number; upcoming: number; completed: number };
}

export interface WishlistItem {
  propertyId: string;
  name: string;
  type: string;
  province: string | null;
  rating: number;
  reviewCount: number;
  photo: string | null;
  /** Null when the property has no active room type to quote from. */
  fromPricePerNight: number | null;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string | null;
  type: string;
  isRead: boolean;
  createdAt: string | null;
}

export interface NotificationFeed {
  items: AppNotification[];
  unread: number;
}
