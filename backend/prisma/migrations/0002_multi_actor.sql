-- LaoStay · 0002_multi_actor
-- Additive only: nothing is dropped or renamed. Safe to re-run.
--
-- 0001 built the admin panel. This one opens the database to the other two
-- actors — partners and customers — plus the columns the payment, chat and
-- photo features need.

-- ── 1. refresh_tokens for three actors ─────────────────────────────────────
-- The table was admin-only (admin_id NOT NULL). Partners and customers get
-- their own nullable FK rather than a loose actor_type/actor_id pair, so a
-- deleted account still takes its sessions with it via ON DELETE CASCADE.
ALTER TABLE refresh_tokens ALTER COLUMN admin_id DROP NOT NULL;

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS partner_id bigint REFERENCES partners (id) ON DELETE CASCADE;
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS user_id    bigint REFERENCES users (id)    ON DELETE CASCADE;

-- Exactly one owner per row. Without this a bug could write a token that
-- belongs to nobody — or to an admin and a customer at once.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'refresh_tokens_one_owner'
  ) THEN
    ALTER TABLE refresh_tokens
      ADD CONSTRAINT refresh_tokens_one_owner
      CHECK (num_nonnulls(admin_id, partner_id, user_id) = 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_partner ON refresh_tokens (partner_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user    ON refresh_tokens (user_id);

-- ── 2. bookings.discount ───────────────────────────────────────────────────
-- Promo codes reduce what the guest pays, but there was nowhere to record by
-- how much. Without this column `subtotal + fee = total` stops being true the
-- moment a promo is used, and every report built on those three numbers lies.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount int NOT NULL DEFAULT 0;

-- ── 3. payments: QR expiry and the raw callback ────────────────────────────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS expires_at   timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS raw_callback jsonb;

-- ── 4. chat_messages.read_at ───────────────────────────────────────────────
-- Drives the unread badge. Null means unread.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- ── 5. rooms.photos ────────────────────────────────────────────────────────
-- properties.photos already existed; rooms had no equivalent.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS photos jsonb;

-- ── 6. service_fee_rate setting ────────────────────────────────────────────
-- The 5% guest-facing service fee was hard-coded in the seed. It belongs next
-- to the other rates so Settings can change it without a deploy.
INSERT INTO app_settings (key, value) VALUES
  ('service_fee_rate', '5'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── 7. Indexes for the new query shapes ────────────────────────────────────
-- Payout generation filters bookings by status + check_out; search filters
-- properties by type; the customer's booking list reads by user + recency.
CREATE INDEX IF NOT EXISTS idx_bookings_status_checkout ON bookings (status, check_out);
CREATE INDEX IF NOT EXISTS idx_bookings_user_created    ON bookings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_properties_type          ON properties (type);
CREATE INDEX IF NOT EXISTS idx_payments_txn_ref         ON payments (txn_ref);
