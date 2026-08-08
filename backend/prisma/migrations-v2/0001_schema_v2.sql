-- LaoStay · schema v2
--
-- 59 tables in 13 modules. This REPLACES the v1 schema entirely: it drops
-- `public` and rebuilds. It is not a migration and there is no path back —
-- v1 data is gone once this runs.
--
-- Kept deliberately out of `prisma/migrations/` so `npm run db:migrate` cannot
-- pick it up by accident. Apply it with `npm run db:migrate:v2`.
--
-- Conventions, applied throughout:
--   * primary keys are `<entity>_id bigint`, matching the design document
--   * money is `bigint` of whole kip with `CHECK (>= 0)` — no floats, and no
--     int4 ceiling at ₭2.1 billion
--   * every timestamp is `timestamptz`; calendar days are `date`
--   * `deleted_at` marks a soft delete; the partial indexes at the bottom keep
--     "WHERE deleted_at IS NULL" queries fast
--   * FKs that carry money are ON DELETE RESTRICT; child media is CASCADE

BEGIN;

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

CREATE EXTENSION IF NOT EXISTS postgis;

-- ════════════════════════════════════════════════════════════════════════════
-- Enums
-- ════════════════════════════════════════════════════════════════════════════

CREATE TYPE user_role          AS ENUM ('CUSTOMER', 'PARTNER', 'ADMIN');
-- Not in the design document, added deliberately: the WebAdmin already
-- enforces that only finance may release a payout, and a single ADMIN role
-- cannot express that. Null for everyone who is not an ADMIN.
CREATE TYPE admin_role         AS ENUM ('super_admin', 'finance', 'staff');
CREATE TYPE user_status        AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE gender_type        AS ENUM ('male', 'female', 'other');
CREATE TYPE otp_purpose        AS ENUM ('register', 'login', 'reset_password', 'verify');

CREATE TYPE business_type      AS ENUM ('individual', 'company');
CREATE TYPE partner_status     AS ENUM ('pending', 'verified', 'rejected', 'suspended');
CREATE TYPE document_type      AS ENUM ('id_card', 'business_license', 'bank_book');
CREATE TYPE document_status    AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE active_status      AS ENUM ('active', 'inactive');

CREATE TYPE property_type      AS ENUM ('homestay', 'villa', 'resort', 'guesthouse');
CREATE TYPE property_status    AS ENUM ('draft', 'active', 'suspended');

CREATE TYPE bed_type           AS ENUM ('single', 'double', 'twin');
CREATE TYPE inventory_status   AS ENUM ('open', 'closed');
CREATE TYPE price_type         AS ENUM ('weekday', 'weekend', 'seasonal', 'holiday');

CREATE TYPE booking_source     AS ENUM ('app', 'walk_in');
CREATE TYPE booking_status     AS ENUM ('pending', 'confirmed', 'staying', 'completed', 'cancelled', 'no_show');
CREATE TYPE guest_type         AS ENUM ('adult', 'child');
CREATE TYPE payment_method     AS ENUM ('phajay_qr');
CREATE TYPE payment_status     AS ENUM ('pending', 'paid', 'expired', 'failed', 'refunded', 'partially_refunded');
CREATE TYPE refund_status      AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE payout_status      AS ENUM ('pending', 'processing', 'paid', 'failed');
CREATE TYPE ledger_entry_type  AS ENUM ('charge', 'commission', 'refund', 'payout', 'adjustment');
CREATE TYPE ledger_direction   AS ENUM ('debit', 'credit');

CREATE TYPE review_status      AS ENUM ('published', 'hidden', 'flagged', 'pending');
CREATE TYPE report_reason      AS ENUM ('spam', 'offensive', 'fake', 'other');
CREATE TYPE report_status      AS ENUM ('pending', 'reviewed', 'dismissed');

CREATE TYPE promotion_type     AS ENUM ('GLOBAL', 'PROPERTY', 'ROOM_TYPE', 'PARTNER');
CREATE TYPE discount_type      AS ENUM ('PERCENTAGE', 'FIXED', 'FREE_NIGHT');
CREATE TYPE promotion_status   AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE coupon_status      AS ENUM ('ACTIVE', 'EXPIRED');

CREATE TYPE conversation_status AS ENUM ('open', 'closed');
CREATE TYPE message_type       AS ENUM ('text', 'image', 'file');

CREATE TYPE notification_type  AS ENUM ('booking', 'payment', 'promo', 'review', 'system');
CREATE TYPE device_platform    AS ENUM ('ios', 'android', 'web');

CREATE TYPE banner_target_type AS ENUM ('property', 'promotion', 'url');
CREATE TYPE target_user_type   AS ENUM ('ALL', 'CUSTOMER', 'PARTNER');
CREATE TYPE agreement_doc_type AS ENUM ('terms', 'privacy', 'partner_agreement');
CREATE TYPE setting_data_type  AS ENUM ('string', 'int', 'boolean', 'json');

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · Master location  (created first: user_profiles and properties point here)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE provinces (
  province_id      bigserial PRIMARY KEY,
  province_code    varchar(20)  NOT NULL UNIQUE,
  province_name_lo varchar(120) NOT NULL,
  province_name_en varchar(120) NOT NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE districts (
  district_id      bigserial PRIMARY KEY,
  province_id      bigint       NOT NULL REFERENCES provinces (province_id) ON DELETE RESTRICT,
  district_code    varchar(20)  NOT NULL,
  district_name_lo varchar(120) NOT NULL,
  district_name_en varchar(120) NOT NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (province_id, district_code)
);

CREATE TABLE villages (
  village_id      bigserial PRIMARY KEY,
  district_id     bigint       NOT NULL REFERENCES districts (district_id) ON DELETE RESTRICT,
  village_code    varchar(20)  NOT NULL,
  village_name_lo varchar(120) NOT NULL,
  village_name_en varchar(120) NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (district_id, village_code)
);

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · Users & auth
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE users (
  user_id       bigserial PRIMARY KEY,
  role          user_role    NOT NULL DEFAULT 'CUSTOMER',
  -- Only meaningful when role = 'ADMIN'; see the admin_role comment above.
  admin_role    admin_role,
  email         varchar(255) NOT NULL UNIQUE,
  phone         varchar(50),
  password_hash varchar(255) NOT NULL,
  status        user_status  NOT NULL DEFAULT 'active',
  is_verified   boolean      NOT NULL DEFAULT false,
  last_login_at timestamptz,
  deleted_at    timestamptz,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT users_admin_role_only_for_admins
    CHECK (admin_role IS NULL OR role = 'ADMIN')
);

CREATE TABLE user_profiles (
  profile_id    bigserial PRIMARY KEY,
  user_id       bigint       NOT NULL UNIQUE REFERENCES users (user_id) ON DELETE CASCADE,
  full_name     varchar(255) NOT NULL,
  avatar_url    varchar(500),
  gender        gender_type,
  date_of_birth date,
  nationality   varchar(100),
  -- PII. Store ciphertext, never the raw number.
  id_number     varchar(255),
  village_id    bigint REFERENCES villages (village_id) ON DELETE SET NULL,
  tier          varchar(20)  NOT NULL DEFAULT 'silver',
  points        int          NOT NULL DEFAULT 0 CHECK (points >= 0),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
  session_id         bigserial PRIMARY KEY,
  user_id            bigint       NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  -- The token itself is never stored: a leaked dump then yields nothing usable.
  refresh_token_hash varchar(255) NOT NULL UNIQUE,
  ip_address         varchar(64),
  user_agent         varchar(500),
  expires_at         timestamptz  NOT NULL,
  revoked_at         timestamptz,
  created_at         timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE otp_verifications (
  otp_id       bigserial PRIMARY KEY,
  -- Null before the account exists — an OTP can precede registration.
  user_id      bigint REFERENCES users (user_id) ON DELETE CASCADE,
  target       varchar(255) NOT NULL,
  purpose      otp_purpose  NOT NULL,
  code_hash    varchar(255) NOT NULL,
  attempts     int          NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts int          NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  expires_at   timestamptz  NOT NULL,
  verified_at  timestamptz,
  created_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE password_reset_tokens (
  token_id   bigserial PRIMARY KEY,
  user_id    bigint       NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  token_hash varchar(255) NOT NULL UNIQUE,
  expires_at timestamptz  NOT NULL,
  used_at    timestamptz,
  created_at timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE login_attempts (
  attempt_id bigserial PRIMARY KEY,
  identifier varchar(255) NOT NULL,
  ip_address varchar(64),
  success    boolean      NOT NULL,
  user_agent varchar(500),
  created_at timestamptz  NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · Partners
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE partners (
  partner_id              bigserial PRIMARY KEY,
  user_id                 bigint         NOT NULL UNIQUE REFERENCES users (user_id) ON DELETE RESTRICT,
  business_name           varchar(255)   NOT NULL,
  business_type           business_type  NOT NULL DEFAULT 'individual',
  tax_id                  varchar(100),
  contact_phone           varchar(50),
  default_commission_rate decimal(5,2)   NOT NULL DEFAULT 5.00  CHECK (default_commission_rate BETWEEN 0 AND 100),
  walkin_commission_rate  decimal(5,2)   NOT NULL DEFAULT 2.50  CHECK (walkin_commission_rate  BETWEEN 0 AND 100),
  status                  partner_status NOT NULL DEFAULT 'pending',
  verified_at             timestamptz,
  deleted_at              timestamptz,
  created_at              timestamptz    NOT NULL DEFAULT now(),
  updated_at              timestamptz    NOT NULL DEFAULT now()
);

CREATE TABLE partner_documents (
  document_id   bigserial PRIMARY KEY,
  partner_id    bigint          NOT NULL REFERENCES partners (partner_id) ON DELETE CASCADE,
  document_type document_type   NOT NULL,
  file_url      varchar(500)    NOT NULL,
  status        document_status NOT NULL DEFAULT 'pending',
  reviewed_by   bigint REFERENCES users (user_id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  created_at    timestamptz     NOT NULL DEFAULT now()
);

CREATE TABLE partner_bank_accounts (
  bank_account_id bigserial PRIMARY KEY,
  partner_id      bigint        NOT NULL REFERENCES partners (partner_id) ON DELETE CASCADE,
  bank_name       varchar(120)  NOT NULL,
  account_name    varchar(255)  NOT NULL,
  -- Encrypted at rest; only the last digits are ever sent to a client.
  account_number  varchar(255)  NOT NULL,
  is_default      boolean       NOT NULL DEFAULT false,
  status          active_status NOT NULL DEFAULT 'active',
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · Properties
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE cancellation_policies (
  cancellation_policy_id bigserial PRIMARY KEY,
  policy_name            varchar(120)  NOT NULL,
  days_before_checkin    int           NOT NULL DEFAULT 0 CHECK (days_before_checkin >= 0),
  penalty_percent        decimal(5,2)  NOT NULL DEFAULT 0 CHECK (penalty_percent BETWEEN 0 AND 100),
  is_refundable          boolean       NOT NULL DEFAULT true,
  description            text,
  status                 active_status NOT NULL DEFAULT 'active',
  created_at             timestamptz   NOT NULL DEFAULT now(),
  updated_at             timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE amenities (
  amenity_id      bigserial PRIMARY KEY,
  amenity_name_lo varchar(120)  NOT NULL,
  amenity_name_en varchar(120)  NOT NULL,
  icon            varchar(80),
  category        varchar(60),
  status          active_status NOT NULL DEFAULT 'active',
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE properties (
  property_id            bigserial PRIMARY KEY,
  partner_id             bigint          NOT NULL REFERENCES partners (partner_id) ON DELETE RESTRICT,
  cancellation_policy_id bigint REFERENCES cancellation_policies (cancellation_policy_id) ON DELETE SET NULL,
  property_name          varchar(255)    NOT NULL,
  property_type          property_type   NOT NULL,
  description            text,
  phone                  varchar(50),
  email                  varchar(255),
  website                varchar(255),
  province_id            bigint REFERENCES provinces (province_id) ON DELETE SET NULL,
  district_id            bigint REFERENCES districts (district_id) ON DELETE SET NULL,
  village_id             bigint REFERENCES villages  (village_id)  ON DELETE SET NULL,
  address_detail         text,
  latitude               decimal(10,7),
  longitude              decimal(11,7),
  -- Derived, so it can never drift from the coordinates above. ST_MakePoint
  -- and ST_SetSRID are immutable, which is what a generated column requires.
  geog geography(Point, 4326) GENERATED ALWAYS AS (
    CASE WHEN latitude IS NULL OR longitude IS NULL THEN NULL
         ELSE ST_SetSRID(ST_MakePoint(longitude::double precision,
                                      latitude::double precision), 4326)::geography
    END
  ) STORED,
  -- 'simple' rather than 'english': Lao text has no English stemming to gain
  -- from, and 'simple' is immutable so this can be a generated column.
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(property_name, '') || ' ' || coalesce(description, ''))
  ) STORED,
  rating_avg      decimal(3,2)    NOT NULL DEFAULT 0 CHECK (rating_avg BETWEEN 0 AND 5),
  review_count    int             NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  status          property_status NOT NULL DEFAULT 'draft',
  deleted_at      timestamptz,
  created_at      timestamptz     NOT NULL DEFAULT now(),
  updated_at      timestamptz     NOT NULL DEFAULT now()
);

CREATE TABLE property_images (
  property_image_id bigserial PRIMARY KEY,
  property_id       bigint       NOT NULL REFERENCES properties (property_id) ON DELETE CASCADE,
  image_url         varchar(500) NOT NULL,
  caption           varchar(255),
  display_order     int          NOT NULL DEFAULT 0,
  is_cover          boolean      NOT NULL DEFAULT false,
  created_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE property_amenities (
  property_amenity_id bigserial PRIMARY KEY,
  property_id         bigint      NOT NULL REFERENCES properties (property_id) ON DELETE CASCADE,
  amenity_id          bigint      NOT NULL REFERENCES amenities  (amenity_id)  ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, amenity_id)
);

CREATE TABLE property_rules (
  property_rule_id  bigserial PRIMARY KEY,
  property_id       bigint      NOT NULL UNIQUE REFERENCES properties (property_id) ON DELETE CASCADE,
  check_in_from     time,
  check_out_until   time,
  smoking_allowed   boolean     NOT NULL DEFAULT false,
  pet_allowed       boolean     NOT NULL DEFAULT false,
  child_allowed     boolean     NOT NULL DEFAULT true,
  party_allowed     boolean     NOT NULL DEFAULT false,
  quiet_hours_start time,
  quiet_hours_end   time,
  additional_note   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · Rooms, inventory & pricing
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE room_types (
  room_type_id     bigserial PRIMARY KEY,
  property_id      bigint        NOT NULL REFERENCES properties (property_id) ON DELETE CASCADE,
  type_name        varchar(255)  NOT NULL,
  description      text,
  bed_type         bed_type      NOT NULL DEFAULT 'double',
  has_ac           boolean       NOT NULL DEFAULT true,
  max_occupancy    int           NOT NULL DEFAULT 2 CHECK (max_occupancy > 0),
  extra_guest_fee  bigint        NOT NULL DEFAULT 0 CHECK (extra_guest_fee >= 0),
  size_sqm         int           CHECK (size_sqm IS NULL OR size_sqm > 0),
  base_price       bigint        NOT NULL CHECK (base_price >= 0),
  total_rooms      int           NOT NULL DEFAULT 1 CHECK (total_rooms > 0),
  min_nights       int           NOT NULL DEFAULT 1 CHECK (min_nights > 0),
  status           active_status NOT NULL DEFAULT 'active',
  deleted_at       timestamptz,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE room_type_images (
  room_image_id bigserial PRIMARY KEY,
  room_type_id  bigint       NOT NULL REFERENCES room_types (room_type_id) ON DELETE CASCADE,
  image_url     varchar(500) NOT NULL,
  caption       varchar(255),
  display_order int          NOT NULL DEFAULT 0,
  is_cover      boolean      NOT NULL DEFAULT false,
  created_at    timestamptz  NOT NULL DEFAULT now()
);

-- The table that makes overbooking impossible.
--
-- `held_count` is the reservation a checkout holds while the guest pays;
-- `booked_count` is confirmed. `available_count` is derived, so it can never
-- disagree with the three numbers it comes from, and the CHECK below refuses
-- any write that would sell more rooms than exist.
CREATE TABLE room_inventory (
  inventory_id    bigserial PRIMARY KEY,
  room_type_id    bigint           NOT NULL REFERENCES room_types (room_type_id) ON DELETE CASCADE,
  date            date             NOT NULL,
  total_count     int              NOT NULL DEFAULT 0 CHECK (total_count  >= 0),
  held_count      int              NOT NULL DEFAULT 0 CHECK (held_count   >= 0),
  booked_count    int              NOT NULL DEFAULT 0 CHECK (booked_count >= 0),
  available_count int GENERATED ALWAYS AS (total_count - held_count - booked_count) STORED,
  status          inventory_status NOT NULL DEFAULT 'open',
  created_at      timestamptz      NOT NULL DEFAULT now(),
  updated_at      timestamptz      NOT NULL DEFAULT now(),
  UNIQUE (room_type_id, date),
  CONSTRAINT room_inventory_no_overbook CHECK (held_count + booked_count <= total_count)
);

CREATE TABLE room_prices (
  price_id     bigserial PRIMARY KEY,
  room_type_id bigint      NOT NULL REFERENCES room_types (room_type_id) ON DELETE CASCADE,
  date         date        NOT NULL,
  price        bigint      NOT NULL CHECK (price >= 0),
  price_type   price_type  NOT NULL DEFAULT 'weekday',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_type_id, date)
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6 · Bookings, payments & finance
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE bookings (
  booking_id             bigserial PRIMARY KEY,
  booking_code           varchar(32)    NOT NULL UNIQUE,
  customer_id            bigint         NOT NULL REFERENCES users      (user_id)     ON DELETE RESTRICT,
  property_id            bigint         NOT NULL REFERENCES properties (property_id) ON DELETE RESTRICT,
  -- Snapshot: the policy in force when the guest booked, even if it changes later.
  cancellation_policy_id bigint REFERENCES cancellation_policies (cancellation_policy_id) ON DELETE SET NULL,
  source                 booking_source NOT NULL DEFAULT 'app',
  check_in               date           NOT NULL,
  check_out              date           NOT NULL,
  nights                 int            NOT NULL CHECK (nights > 0),
  total_guests           int            NOT NULL DEFAULT 1 CHECK (total_guests > 0),
  subtotal_amount        bigint         NOT NULL DEFAULT 0 CHECK (subtotal_amount  >= 0),
  discount_amount        bigint         NOT NULL DEFAULT 0 CHECK (discount_amount  >= 0),
  tax_amount             bigint         NOT NULL DEFAULT 0 CHECK (tax_amount       >= 0),
  service_fee            bigint         NOT NULL DEFAULT 0 CHECK (service_fee      >= 0),
  cleaning_fee           bigint         NOT NULL DEFAULT 0 CHECK (cleaning_fee     >= 0),
  -- Snapshot too: a later rate change must not restate what was already earned.
  commission_rate        decimal(5,2)   NOT NULL DEFAULT 0 CHECK (commission_rate BETWEEN 0 AND 100),
  commission_amount      bigint         NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  total_amount           bigint         NOT NULL DEFAULT 0 CHECK (total_amount      >= 0),
  payout_amount          bigint         NOT NULL DEFAULT 0 CHECK (payout_amount     >= 0),
  currency               char(3)        NOT NULL DEFAULT 'LAK',
  status                 booking_status NOT NULL DEFAULT 'pending',
  -- When a `pending` booking stops holding inventory. The sweeper cancels it
  -- and releases held_count; without this a dropped checkout blocks a room
  -- forever.
  hold_expires_at        timestamptz,
  special_request        text,
  idempotency_key        varchar(255)   UNIQUE,
  deleted_at             timestamptz,
  created_at             timestamptz    NOT NULL DEFAULT now(),
  updated_at             timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT bookings_checkout_after_checkin CHECK (check_out > check_in),
  -- The two sums the whole platform is built on. `payouts` already refuses a
  -- row that does not balance; a booking that does not balance is the same
  -- error one step earlier, and it is far cheaper to catch here than to find
  -- out at payout time that a partner is owed a number nobody can reproduce.
  CONSTRAINT bookings_total_balances CHECK (
    total_amount = subtotal_amount + service_fee + tax_amount + cleaning_fee - discount_amount
  ),
  CONSTRAINT bookings_payout_balances CHECK (payout_amount = total_amount - commission_amount)
);

CREATE TABLE booking_items (
  booking_item_id bigserial PRIMARY KEY,
  booking_id      bigint      NOT NULL REFERENCES bookings   (booking_id)   ON DELETE CASCADE,
  room_type_id    bigint      NOT NULL REFERENCES room_types (room_type_id) ON DELETE RESTRICT,
  quantity        int         NOT NULL DEFAULT 1 CHECK (quantity > 0),
  nights          int         NOT NULL CHECK (nights > 0),
  -- Snapshot of the nightly rate, so a price change never rewrites history.
  price_per_night bigint      NOT NULL CHECK (price_per_night >= 0),
  subtotal        bigint      NOT NULL CHECK (subtotal >= 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE booking_guests (
  guest_id   bigserial PRIMARY KEY,
  booking_id bigint       NOT NULL REFERENCES bookings (booking_id) ON DELETE CASCADE,
  full_name  varchar(255) NOT NULL,
  guest_type guest_type   NOT NULL DEFAULT 'adult',
  -- PII, encrypted at rest like user_profiles.id_number.
  id_number  varchar(255),
  is_primary boolean      NOT NULL DEFAULT false,
  created_at timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE booking_status_logs (
  status_log_id bigserial PRIMARY KEY,
  booking_id    bigint         NOT NULL REFERENCES bookings (booking_id) ON DELETE CASCADE,
  from_status   booking_status,
  to_status     booking_status NOT NULL,
  -- Null when the system moved it (hold expiry, auto check-out).
  changed_by    bigint REFERENCES users (user_id) ON DELETE SET NULL,
  note          varchar(500),
  created_at    timestamptz    NOT NULL DEFAULT now()
);

-- One booking may have several payment rows: a QR that expires is not deleted,
-- it is kept as evidence and a fresh one is issued. `idempotency_key` is what
-- stops a double-tap creating two live charges.
CREATE TABLE payments (
  payment_id      bigserial PRIMARY KEY,
  booking_id      bigint         NOT NULL REFERENCES bookings (booking_id) ON DELETE RESTRICT,
  payment_method  payment_method NOT NULL DEFAULT 'phajay_qr',
  idempotency_key varchar(255)   NOT NULL UNIQUE,
  qr_payload      text,
  amount          bigint         NOT NULL CHECK (amount >= 0),
  status          payment_status NOT NULL DEFAULT 'pending',
  txn_ref         varchar(120),
  paid_at         timestamptz,
  expired_at      timestamptz,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now()
);

CREATE TABLE payment_events (
  event_id     bigserial PRIMARY KEY,
  payment_id   bigint       NOT NULL REFERENCES payments (payment_id) ON DELETE CASCADE,
  event_type   varchar(60)  NOT NULL,
  provider_ref varchar(120),
  -- The provider's bytes, kept verbatim. A dispute is argued from this.
  raw_payload  jsonb        NOT NULL,
  signature    varchar(255),
  received_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE refunds (
  refund_id    bigserial PRIMARY KEY,
  payment_id   bigint        NOT NULL REFERENCES payments (payment_id) ON DELETE RESTRICT,
  booking_id   bigint        NOT NULL REFERENCES bookings (booking_id) ON DELETE RESTRICT,
  amount       bigint        NOT NULL CHECK (amount >= 0),
  reason       varchar(255),
  status       refund_status NOT NULL DEFAULT 'pending',
  txn_ref      varchar(120),
  processed_by bigint REFERENCES users (user_id) ON DELETE SET NULL,
  refunded_at  timestamptz,
  created_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE booking_cancellations (
  cancellation_id bigserial PRIMARY KEY,
  booking_id      bigint      NOT NULL UNIQUE REFERENCES bookings (booking_id) ON DELETE RESTRICT,
  cancelled_by    bigint REFERENCES users (user_id) ON DELETE SET NULL,
  reason          varchar(255),
  -- The policy as it read at the moment of cancelling — the arithmetic must
  -- stay explainable years later.
  policy_snapshot jsonb,
  penalty_amount  bigint      NOT NULL DEFAULT 0 CHECK (penalty_amount >= 0),
  refund_amount   bigint      NOT NULL DEFAULT 0 CHECK (refund_amount  >= 0),
  refund_id       bigint REFERENCES refunds (refund_id) ON DELETE SET NULL,
  cancelled_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  payout_id         bigserial PRIMARY KEY,
  partner_id        bigint        NOT NULL REFERENCES partners (partner_id) ON DELETE RESTRICT,
  bank_account_id   bigint REFERENCES partner_bank_accounts (bank_account_id) ON DELETE SET NULL,
  period_start      date          NOT NULL,
  period_end        date          NOT NULL,
  gross_amount      bigint        NOT NULL DEFAULT 0 CHECK (gross_amount      >= 0),
  commission_amount bigint        NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  net_amount        bigint        NOT NULL DEFAULT 0 CHECK (net_amount        >= 0),
  status            payout_status NOT NULL DEFAULT 'pending',
  confirmed_by      bigint REFERENCES users (user_id) ON DELETE SET NULL,
  paid_at           timestamptz,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT payouts_period_ordered CHECK (period_end >= period_start),
  CONSTRAINT payouts_net_balances   CHECK (gross_amount = commission_amount + net_amount)
);

CREATE TABLE payout_items (
  payout_item_id    bigserial PRIMARY KEY,
  payout_id         bigint      NOT NULL REFERENCES payouts  (payout_id)  ON DELETE CASCADE,
  booking_id        bigint      NOT NULL REFERENCES bookings (booking_id) ON DELETE RESTRICT,
  gross_amount      bigint      NOT NULL DEFAULT 0 CHECK (gross_amount      >= 0),
  commission_amount bigint      NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  net_amount        bigint      NOT NULL DEFAULT 0 CHECK (net_amount        >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payout_id, booking_id),
  CONSTRAINT payout_items_net_balances CHECK (gross_amount = commission_amount + net_amount)
);

-- Every movement of money, in one place.
--
-- `balance_after` is a convenience for reading a statement; it is only correct
-- if writes for a given partner are serialised. Treat SUM(amount) as the source
-- of truth when the two ever disagree.
CREATE TABLE ledger_entries (
  ledger_id      bigserial PRIMARY KEY,
  entry_type     ledger_entry_type NOT NULL,
  booking_id     bigint REFERENCES bookings (booking_id) ON DELETE RESTRICT,
  partner_id     bigint REFERENCES partners (partner_id) ON DELETE RESTRICT,
  reference_type varchar(60),
  reference_id   bigint,
  direction      ledger_direction  NOT NULL,
  amount         bigint            NOT NULL CHECK (amount >= 0),
  balance_after  bigint,
  note           varchar(255),
  created_at     timestamptz       NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7 · Reviews
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE reviews (
  review_id          bigserial PRIMARY KEY,
  -- One review per stay. This is the whole anti-astroturfing measure.
  booking_id         bigint        NOT NULL UNIQUE REFERENCES bookings   (booking_id)  ON DELETE RESTRICT,
  customer_id        bigint        NOT NULL REFERENCES users      (user_id)     ON DELETE RESTRICT,
  property_id        bigint        NOT NULL REFERENCES properties (property_id) ON DELETE CASCADE,
  overall_rating     decimal(2,1)  NOT NULL CHECK (overall_rating     BETWEEN 1 AND 5),
  cleanliness_rating int           CHECK (cleanliness_rating IS NULL OR cleanliness_rating BETWEEN 1 AND 5),
  service_rating     int           CHECK (service_rating     IS NULL OR service_rating     BETWEEN 1 AND 5),
  value_rating       int           CHECK (value_rating       IS NULL OR value_rating       BETWEEN 1 AND 5),
  title              varchar(255),
  comment            text,
  status             review_status NOT NULL DEFAULT 'published',
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE review_images (
  review_image_id bigserial PRIMARY KEY,
  review_id       bigint       NOT NULL REFERENCES reviews (review_id) ON DELETE CASCADE,
  image_url       varchar(500) NOT NULL,
  display_order   int          NOT NULL DEFAULT 0,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE review_replies (
  reply_id        bigserial PRIMARY KEY,
  review_id       bigint      NOT NULL REFERENCES reviews (review_id) ON DELETE CASCADE,
  user_id         bigint      NOT NULL REFERENCES users   (user_id)   ON DELETE RESTRICT,
  reply_text      text        NOT NULL,
  parent_reply_id bigint REFERENCES review_replies (reply_id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE review_reports (
  report_id   bigserial PRIMARY KEY,
  review_id   bigint        NOT NULL REFERENCES reviews (review_id) ON DELETE CASCADE,
  reported_by bigint        NOT NULL REFERENCES users   (user_id)   ON DELETE RESTRICT,
  reason      report_reason NOT NULL,
  detail      text,
  status      report_status NOT NULL DEFAULT 'pending',
  handled_by  bigint REFERENCES users (user_id) ON DELETE SET NULL,
  created_at  timestamptz   NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8 · Promotions & coupons
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE promotions (
  promotion_id     bigserial PRIMARY KEY,
  promotion_name   varchar(255)     NOT NULL,
  description      text,
  promotion_type   promotion_type   NOT NULL DEFAULT 'GLOBAL',
  discount_type    discount_type    NOT NULL,
  discount_value   bigint           NOT NULL DEFAULT 0 CHECK (discount_value   >= 0),
  max_discount     bigint           CHECK (max_discount     IS NULL OR max_discount     >= 0),
  minimum_spending bigint           NOT NULL DEFAULT 0 CHECK (minimum_spending >= 0),
  allow_stack      boolean          NOT NULL DEFAULT false,
  start_date       date             NOT NULL,
  end_date         date             NOT NULL,
  status           promotion_status NOT NULL DEFAULT 'ACTIVE',
  created_by       bigint REFERENCES users (user_id) ON DELETE SET NULL,
  created_at       timestamptz      NOT NULL DEFAULT now(),
  updated_at       timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT promotions_dates_ordered CHECK (end_date >= start_date)
);

CREATE TABLE promotion_properties (
  promotion_property_id bigserial PRIMARY KEY,
  promotion_id          bigint      NOT NULL REFERENCES promotions (promotion_id) ON DELETE CASCADE,
  property_id           bigint      NOT NULL REFERENCES properties (property_id)  ON DELETE CASCADE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promotion_id, property_id)
);

CREATE TABLE promotion_room_types (
  promotion_room_type_id bigserial PRIMARY KEY,
  promotion_id           bigint      NOT NULL REFERENCES promotions (promotion_id) ON DELETE CASCADE,
  room_type_id           bigint      NOT NULL REFERENCES room_types (room_type_id) ON DELETE CASCADE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promotion_id, room_type_id)
);

CREATE TABLE promotion_partners (
  promotion_partner_id bigserial PRIMARY KEY,
  promotion_id         bigint      NOT NULL REFERENCES promotions (promotion_id) ON DELETE CASCADE,
  partner_id           bigint      NOT NULL REFERENCES partners   (partner_id)   ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promotion_id, partner_id)
);

CREATE TABLE coupons (
  coupon_id      bigserial PRIMARY KEY,
  promotion_id   bigint        NOT NULL REFERENCES promotions (promotion_id) ON DELETE CASCADE,
  coupon_code    varchar(60)   NOT NULL UNIQUE,
  usage_limit    int           CHECK (usage_limit    IS NULL OR usage_limit    > 0),
  usage_per_user int           CHECK (usage_per_user IS NULL OR usage_per_user > 0),
  used_count     int           NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  start_date     date,
  end_date       date,
  status         coupon_status NOT NULL DEFAULT 'ACTIVE',
  created_by     bigint REFERENCES users (user_id) ON DELETE SET NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE coupon_usages (
  usage_id        bigserial PRIMARY KEY,
  coupon_id       bigint      NOT NULL REFERENCES coupons  (coupon_id)  ON DELETE RESTRICT,
  booking_id      bigint      NOT NULL REFERENCES bookings (booking_id) ON DELETE RESTRICT,
  customer_id     bigint      NOT NULL REFERENCES users    (user_id)    ON DELETE RESTRICT,
  discount_amount bigint      NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  used_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, booking_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9 · Chat & messaging
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE conversations (
  conversation_id bigserial PRIMARY KEY,
  customer_id     bigint              NOT NULL REFERENCES users      (user_id)     ON DELETE CASCADE,
  property_id     bigint              NOT NULL REFERENCES properties (property_id) ON DELETE CASCADE,
  booking_id      bigint REFERENCES bookings (booking_id) ON DELETE SET NULL,
  -- FK added after `messages` exists; the two reference each other.
  last_message_id bigint,
  last_message_at timestamptz,
  status          conversation_status NOT NULL DEFAULT 'open',
  created_at      timestamptz         NOT NULL DEFAULT now(),
  updated_at      timestamptz         NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  message_id           bigserial PRIMARY KEY,
  conversation_id      bigint       NOT NULL REFERENCES conversations (conversation_id) ON DELETE CASCADE,
  sender_id            bigint       NOT NULL REFERENCES users         (user_id)         ON DELETE RESTRICT,
  reply_to_message_id  bigint REFERENCES messages (message_id) ON DELETE SET NULL,
  message_type         message_type NOT NULL DEFAULT 'text',
  message_text         text,
  is_edited            boolean      NOT NULL DEFAULT false,
  edited_at            timestamptz,
  -- Soft delete: the row stays so the thread still reads in order, and the UI
  -- shows "this message was deleted".
  is_deleted           boolean      NOT NULL DEFAULT false,
  deleted_at           timestamptz,
  created_at           timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE conversations
  ADD CONSTRAINT conversations_last_message_fkey
  FOREIGN KEY (last_message_id) REFERENCES messages (message_id) ON DELETE SET NULL;

CREATE TABLE message_attachments (
  attachment_id bigserial PRIMARY KEY,
  message_id    bigint       NOT NULL REFERENCES messages (message_id) ON DELETE CASCADE,
  file_url      varchar(500) NOT NULL,
  file_name     varchar(255),
  mime_type     varchar(120),
  file_size     int          CHECK (file_size IS NULL OR file_size >= 0),
  created_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE conversation_reads (
  conversation_read_id  bigserial PRIMARY KEY,
  conversation_id       bigint      NOT NULL REFERENCES conversations (conversation_id) ON DELETE CASCADE,
  user_id               bigint      NOT NULL REFERENCES users         (user_id)         ON DELETE CASCADE,
  last_read_message_id  bigint REFERENCES messages (message_id) ON DELETE SET NULL,
  read_at               timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- 10 · Notifications
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE notifications (
  notification_id   bigserial PRIMARY KEY,
  user_id           bigint            NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  title             varchar(255)      NOT NULL,
  message           text,
  notification_type notification_type NOT NULL DEFAULT 'system',
  reference_type    varchar(60),
  reference_id      bigint,
  is_read           boolean           NOT NULL DEFAULT false,
  read_at           timestamptz,
  created_at        timestamptz       NOT NULL DEFAULT now()
);

CREATE TABLE user_device_tokens (
  device_token_id bigserial PRIMARY KEY,
  user_id         bigint          NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  device_token    varchar(500)    NOT NULL UNIQUE,
  platform        device_platform NOT NULL,
  device_name     varchar(255),
  is_active       boolean         NOT NULL DEFAULT true,
  last_used_at    timestamptz,
  created_at      timestamptz     NOT NULL DEFAULT now(),
  updated_at      timestamptz     NOT NULL DEFAULT now()
);

CREATE TABLE notification_templates (
  template_id       bigserial PRIMARY KEY,
  template_code     varchar(80)       NOT NULL UNIQUE,
  title_template    varchar(255)      NOT NULL,
  message_template  text              NOT NULL,
  notification_type notification_type NOT NULL DEFAULT 'system',
  is_active         boolean           NOT NULL DEFAULT true,
  created_at        timestamptz       NOT NULL DEFAULT now(),
  updated_at        timestamptz       NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 11 · Wishlist
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE wishlist_items (
  wishlist_item_id bigserial PRIMARY KEY,
  user_id          bigint      NOT NULL REFERENCES users      (user_id)     ON DELETE CASCADE,
  property_id      bigint      NOT NULL REFERENCES properties (property_id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, property_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- 12 · Admin & CMS
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE banners (
  banner_id     bigserial PRIMARY KEY,
  title         varchar(255) NOT NULL,
  description   text,
  image_url     varchar(500),
  target_type   banner_target_type,
  target_id     bigint,
  display_order int          NOT NULL DEFAULT 0,
  start_date    date,
  end_date      date,
  is_active     boolean      NOT NULL DEFAULT true,
  created_by    bigint REFERENCES users (user_id) ON DELETE SET NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE announcements (
  announcement_id  bigserial PRIMARY KEY,
  title            varchar(255)     NOT NULL,
  content          text,
  start_date       date,
  end_date         date,
  target_user_type target_user_type NOT NULL DEFAULT 'ALL',
  is_active        boolean          NOT NULL DEFAULT true,
  created_by       bigint REFERENCES users (user_id) ON DELETE SET NULL,
  created_at       timestamptz      NOT NULL DEFAULT now(),
  updated_at       timestamptz      NOT NULL DEFAULT now()
);

CREATE TABLE faqs (
  faq_id        bigserial PRIMARY KEY,
  category      varchar(80),
  question      text        NOT NULL,
  answer        text        NOT NULL,
  display_order int         NOT NULL DEFAULT 0,
  is_active     boolean     NOT NULL DEFAULT true,
  created_by    bigint REFERENCES users (user_id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_agreements (
  agreement_id  bigserial PRIMARY KEY,
  user_id       bigint             NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  document_type agreement_doc_type NOT NULL,
  version       varchar(40)        NOT NULL,
  accepted_at   timestamptz        NOT NULL DEFAULT now(),
  ip_address    varchar(64)
);

CREATE TABLE app_settings (
  setting_id    bigserial PRIMARY KEY,
  setting_key   varchar(120) NOT NULL UNIQUE,
  setting_value text,
  description   varchar(255),
  updated_by    bigint REFERENCES users (user_id) ON DELETE SET NULL,
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE app_pages (
  page_id    bigserial PRIMARY KEY,
  page_slug  varchar(120) NOT NULL UNIQUE,
  title      varchar(255) NOT NULL,
  content    text,
  is_active  boolean      NOT NULL DEFAULT true,
  updated_by bigint REFERENCES users (user_id) ON DELETE SET NULL,
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 13 · System & audit
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE audit_logs (
  audit_log_id bigserial PRIMARY KEY,
  -- Null when the system acted on its own (hold sweeper, payout generator).
  user_id      bigint REFERENCES users (user_id) ON DELETE SET NULL,
  action       varchar(120) NOT NULL,
  module_name  varchar(80),
  table_name   varchar(80),
  record_id    bigint,
  old_values   jsonb,
  new_values   jsonb,
  ip_address   varchar(64),
  user_agent   varchar(500),
  created_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE system_settings (
  setting_id    bigserial PRIMARY KEY,
  setting_group varchar(60),
  setting_key   varchar(120)      NOT NULL UNIQUE,
  setting_value text,
  data_type     setting_data_type NOT NULL DEFAULT 'string',
  description   varchar(255),
  updated_by    bigint REFERENCES users (user_id) ON DELETE SET NULL,
  updated_at    timestamptz       NOT NULL DEFAULT now()
);

COMMIT;
