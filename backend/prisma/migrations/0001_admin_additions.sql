-- LaoStay · 0001_admin_additions
-- Additive only: nothing is dropped or renamed. Safe to re-run (all IF NOT EXISTS).
--
-- The 17 design tables already exist in Neon. This migration adds the four things
-- the WebAdmin needs that the original schema did not cover.

-- ── 1. app_settings ────────────────────────────────────────────────────────
-- Platform config edited on the Settings screen (commission rate, cancellation
-- fee, platform name, contact email). Stored key/value so new settings do not
-- need a migration.
CREATE TABLE IF NOT EXISTS app_settings (
  key         varchar(100) PRIMARY KEY,
  value       jsonb        NOT NULL,
  updated_at  timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by  bigint       REFERENCES admins (id) ON DELETE SET NULL
);

INSERT INTO app_settings (key, value) VALUES
  ('platform_name',          '"LaoStay · ພັກເຮືອນລາວ"'::jsonb),
  ('contact_email',          '"support@laostay.la"'::jsonb),
  ('commission_rate',        '5'::jsonb),
  ('walkin_commission_rate', '2.5'::jsonb),
  ('cancellation_fee_rate',  '30'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── 2. refresh_tokens ──────────────────────────────────────────────────────
-- Refresh tokens are stored hashed so logout / "revoke all sessions" actually
-- invalidates a token instead of relying on client-side deletion.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          bigserial    PRIMARY KEY,
  admin_id    bigint       NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
  token_hash  varchar(255) NOT NULL UNIQUE,
  expires_at  timestamptz  NOT NULL,
  revoked_at  timestamptz,
  ip_address  varchar(50),
  created_at  timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_admin   ON refresh_tokens (admin_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens (expires_at);

-- ── 3. Foreign-key & lookup indexes ────────────────────────────────────────
-- The database had no indexes at all beyond primary keys and uniques, so every
-- join and every filtered list was a sequential scan.
CREATE INDEX IF NOT EXISTS idx_bookings_user            ON bookings (user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_property        ON bookings (property_id);
CREATE INDEX IF NOT EXISTS idx_bookings_room            ON bookings (room_id);
CREATE INDEX IF NOT EXISTS idx_bookings_promo           ON bookings (promo_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status_created  ON bookings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_created         ON bookings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_checkin         ON bookings (check_in);

CREATE INDEX IF NOT EXISTS idx_properties_partner       ON properties (partner_id);
CREATE INDEX IF NOT EXISTS idx_properties_province      ON properties (province);

CREATE INDEX IF NOT EXISTS idx_rooms_property           ON rooms (property_id);

CREATE INDEX IF NOT EXISTS idx_booking_items_booking    ON booking_items (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_items_room       ON booking_items (room_id);

CREATE INDEX IF NOT EXISTS idx_payments_booking         ON payments (booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_status          ON payments (status);

CREATE INDEX IF NOT EXISTS idx_payouts_partner_status   ON payouts (partner_id, status);
CREATE INDEX IF NOT EXISTS idx_payouts_period           ON payouts (period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_reviews_property         ON reviews (property_id);
CREATE INDEX IF NOT EXISTS idx_reviews_booking          ON reviews (booking_id);
CREATE INDEX IF NOT EXISTS idx_reviews_flagged          ON reviews (is_flagged) WHERE is_flagged;

CREATE INDEX IF NOT EXISTS idx_cancellations_booking    ON cancellations (booking_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_booking    ON chat_messages (booking_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_wishlists_user           ON wishlists (user_id);
CREATE INDEX IF NOT EXISTS idx_wishlists_property       ON wishlists (property_id);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON notifications (recipient_type, recipient_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs (actor_type, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created       ON audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_partners_status          ON partners (status);
CREATE INDEX IF NOT EXISTS idx_users_status             ON users (status);
CREATE INDEX IF NOT EXISTS idx_room_availability_date   ON room_availability (date);

-- ── 4. partners.commission_rate default ────────────────────────────────────
-- Was 17.00, which contradicts the product rules (5% app / 2.5% walk-in).
-- Only the DEFAULT changes; existing rows are left alone.
ALTER TABLE partners ALTER COLUMN commission_rate SET DEFAULT 5.00;
