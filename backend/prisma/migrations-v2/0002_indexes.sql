-- LaoStay · schema v2 — indexes
--
-- Every foreign key gets one: without it, both the JOIN and the referential
-- check on the parent's delete fall back to a sequential scan. The rest are the
-- access paths the product actually uses, listed with the query they serve.

BEGIN;

-- ── users & auth ────────────────────────────────────────────────────────────
CREATE INDEX idx_users_role_status        ON users (role, status);
CREATE INDEX idx_users_phone              ON users (phone);
-- Soft delete: nearly every read filters on this, so the partial index keeps
-- deleted rows out of the scan entirely.
CREATE INDEX idx_users_alive              ON users (user_id) WHERE deleted_at IS NULL;

CREATE INDEX idx_user_profiles_village    ON user_profiles (village_id);

CREATE INDEX idx_user_sessions_user       ON user_sessions (user_id);
CREATE INDEX idx_user_sessions_expires    ON user_sessions (expires_at);
CREATE INDEX idx_user_sessions_live       ON user_sessions (user_id) WHERE revoked_at IS NULL;

CREATE INDEX idx_otp_user                 ON otp_verifications (user_id);
-- "the newest unexpired OTP for this phone/email, for this purpose"
CREATE INDEX idx_otp_target_purpose       ON otp_verifications (target, purpose, created_at DESC);

CREATE INDEX idx_password_reset_user      ON password_reset_tokens (user_id);

-- Brute-force lockout: count failures for one identifier in a time window.
CREATE INDEX idx_login_attempts_lookup    ON login_attempts (identifier, created_at DESC);
CREATE INDEX idx_login_attempts_ip        ON login_attempts (ip_address, created_at DESC);

-- ── partners ────────────────────────────────────────────────────────────────
CREATE INDEX idx_partners_status          ON partners (status);
CREATE INDEX idx_partners_alive           ON partners (partner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_partner_documents_partner ON partner_documents (partner_id);
CREATE INDEX idx_partner_documents_review  ON partner_documents (reviewed_by);
CREATE INDEX idx_partner_bank_partner      ON partner_bank_accounts (partner_id);

-- ── location ────────────────────────────────────────────────────────────────
CREATE INDEX idx_districts_province       ON districts (province_id);
CREATE INDEX idx_villages_district        ON villages  (district_id);

-- ── properties ──────────────────────────────────────────────────────────────
CREATE INDEX idx_properties_partner       ON properties (partner_id);
CREATE INDEX idx_properties_province      ON properties (province_id);
CREATE INDEX idx_properties_district      ON properties (district_id);
CREATE INDEX idx_properties_village       ON properties (village_id);
CREATE INDEX idx_properties_policy        ON properties (cancellation_policy_id);
CREATE INDEX idx_properties_type_status   ON properties (property_type, status);
CREATE INDEX idx_properties_alive         ON properties (property_id) WHERE deleted_at IS NULL;
-- "near me" / map viewport
CREATE INDEX idx_properties_geog          ON properties USING GIST (geog);
-- free-text over name + description
CREATE INDEX idx_properties_search        ON properties USING GIN (search_vector);

CREATE INDEX idx_property_images_property ON property_images (property_id, display_order);
CREATE INDEX idx_property_amenities_amenity ON property_amenities (amenity_id);

-- ── rooms, inventory, pricing ───────────────────────────────────────────────
CREATE INDEX idx_room_types_property      ON room_types (property_id);
CREATE INDEX idx_room_types_alive         ON room_types (room_type_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_room_type_images_room    ON room_type_images (room_type_id, display_order);

-- UNIQUE(room_type_id, date) already exists on both tables and is the hot path
-- for availability and pricing. These two serve the cross-property queries.
CREATE INDEX idx_room_inventory_date      ON room_inventory (date);
-- "which room types still have space on this date"
CREATE INDEX idx_room_inventory_available ON room_inventory (date, room_type_id)
  WHERE available_count > 0 AND status = 'open';
CREATE INDEX idx_room_prices_date         ON room_prices (date);

-- ── bookings & finance ──────────────────────────────────────────────────────
CREATE INDEX idx_bookings_customer_status ON bookings (customer_id, status);
CREATE INDEX idx_bookings_property_checkin ON bookings (property_id, check_in);
CREATE INDEX idx_bookings_status_created  ON bookings (status, created_at DESC);
CREATE INDEX idx_bookings_checkout        ON bookings (check_out);
CREATE INDEX idx_bookings_policy          ON bookings (cancellation_policy_id);
CREATE INDEX idx_bookings_alive           ON bookings (booking_id) WHERE deleted_at IS NULL;
-- The sweeper's query: pending holds that have run out of time.
CREATE INDEX idx_bookings_expiring_holds  ON bookings (hold_expires_at)
  WHERE status = 'pending' AND hold_expires_at IS NOT NULL;

CREATE INDEX idx_booking_items_booking    ON booking_items (booking_id);
CREATE INDEX idx_booking_items_room_type  ON booking_items (room_type_id);
CREATE INDEX idx_booking_guests_booking   ON booking_guests (booking_id);
CREATE INDEX idx_booking_status_logs_booking ON booking_status_logs (booking_id, created_at DESC);
CREATE INDEX idx_booking_status_logs_actor   ON booking_status_logs (changed_by);

CREATE INDEX idx_payments_booking_status  ON payments (booking_id, status);
CREATE INDEX idx_payments_txn_ref         ON payments (txn_ref);
CREATE INDEX idx_payment_events_payment   ON payment_events (payment_id, received_at DESC);
CREATE INDEX idx_payment_events_provider  ON payment_events (provider_ref);

CREATE INDEX idx_refunds_payment          ON refunds (payment_id);
CREATE INDEX idx_refunds_booking          ON refunds (booking_id);
CREATE INDEX idx_refunds_status           ON refunds (status);
CREATE INDEX idx_refunds_processor        ON refunds (processed_by);

CREATE INDEX idx_booking_cancellations_actor  ON booking_cancellations (cancelled_by);
CREATE INDEX idx_booking_cancellations_refund ON booking_cancellations (refund_id);

CREATE INDEX idx_payouts_partner_status   ON payouts (partner_id, status);
CREATE INDEX idx_payouts_period           ON payouts (period_start, period_end);
CREATE INDEX idx_payouts_bank_account     ON payouts (bank_account_id);
CREATE INDEX idx_payouts_confirmer        ON payouts (confirmed_by);

CREATE INDEX idx_payout_items_payout      ON payout_items (payout_id);
CREATE INDEX idx_payout_items_booking     ON payout_items (booking_id);

-- Reconciliation reads the ledger by booking and by partner.
CREATE INDEX idx_ledger_booking           ON ledger_entries (booking_id);
CREATE INDEX idx_ledger_partner_created   ON ledger_entries (partner_id, created_at DESC);
CREATE INDEX idx_ledger_type              ON ledger_entries (entry_type, created_at DESC);
CREATE INDEX idx_ledger_reference         ON ledger_entries (reference_type, reference_id);

-- ── reviews ─────────────────────────────────────────────────────────────────
CREATE INDEX idx_reviews_property_status  ON reviews (property_id, status);
CREATE INDEX idx_reviews_customer         ON reviews (customer_id);
CREATE INDEX idx_review_images_review     ON review_images (review_id, display_order);
CREATE INDEX idx_review_replies_review    ON review_replies (review_id);
CREATE INDEX idx_review_replies_user      ON review_replies (user_id);
CREATE INDEX idx_review_replies_parent    ON review_replies (parent_reply_id);
CREATE INDEX idx_review_reports_review    ON review_reports (review_id);
CREATE INDEX idx_review_reports_status    ON review_reports (status);
CREATE INDEX idx_review_reports_reporter  ON review_reports (reported_by);
CREATE INDEX idx_review_reports_handler   ON review_reports (handled_by);

-- ── promotions ──────────────────────────────────────────────────────────────
CREATE INDEX idx_promotions_status_dates  ON promotions (status, start_date, end_date);
CREATE INDEX idx_promotions_creator       ON promotions (created_by);
CREATE INDEX idx_promotion_properties_property ON promotion_properties (property_id);
CREATE INDEX idx_promotion_room_types_room     ON promotion_room_types (room_type_id);
CREATE INDEX idx_promotion_partners_partner    ON promotion_partners (partner_id);
CREATE INDEX idx_coupons_promotion         ON coupons (promotion_id);
CREATE INDEX idx_coupons_status            ON coupons (status);
CREATE INDEX idx_coupons_creator           ON coupons (created_by);
-- Enforces usage_per_user without a table scan.
CREATE INDEX idx_coupon_usages_coupon_customer ON coupon_usages (coupon_id, customer_id);
CREATE INDEX idx_coupon_usages_booking     ON coupon_usages (booking_id);

-- ── chat ────────────────────────────────────────────────────────────────────
CREATE INDEX idx_conversations_customer   ON conversations (customer_id, last_message_at DESC);
CREATE INDEX idx_conversations_property   ON conversations (property_id, last_message_at DESC);
CREATE INDEX idx_conversations_booking    ON conversations (booking_id);
CREATE INDEX idx_conversations_last_msg   ON conversations (last_message_id);
-- Paginating a thread.
CREATE INDEX idx_messages_conversation    ON messages (conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender          ON messages (sender_id);
CREATE INDEX idx_messages_reply_to        ON messages (reply_to_message_id);
CREATE INDEX idx_message_attachments_msg  ON message_attachments (message_id);
CREATE INDEX idx_conversation_reads_user  ON conversation_reads (user_id);
CREATE INDEX idx_conversation_reads_msg   ON conversation_reads (last_read_message_id);

-- ── notifications ───────────────────────────────────────────────────────────
CREATE INDEX idx_notifications_user       ON notifications (user_id, is_read, created_at DESC);
CREATE INDEX idx_device_tokens_user       ON user_device_tokens (user_id) WHERE is_active;

-- ── wishlist ────────────────────────────────────────────────────────────────
CREATE INDEX idx_wishlist_property        ON wishlist_items (property_id);

-- ── CMS ─────────────────────────────────────────────────────────────────────
CREATE INDEX idx_banners_active           ON banners (is_active, display_order);
CREATE INDEX idx_banners_creator          ON banners (created_by);
CREATE INDEX idx_announcements_active     ON announcements (is_active, start_date, end_date);
CREATE INDEX idx_announcements_creator    ON announcements (created_by);
CREATE INDEX idx_faqs_active              ON faqs (is_active, display_order);
CREATE INDEX idx_faqs_creator             ON faqs (created_by);
CREATE INDEX idx_user_agreements_user     ON user_agreements (user_id, document_type);
CREATE INDEX idx_app_settings_updater     ON app_settings (updated_by);
CREATE INDEX idx_app_pages_updater        ON app_pages (updated_by);

-- ── audit ───────────────────────────────────────────────────────────────────
CREATE INDEX idx_audit_logs_user          ON audit_logs (user_id, created_at DESC);
CREATE INDEX idx_audit_logs_created       ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_record        ON audit_logs (table_name, record_id);
CREATE INDEX idx_system_settings_group    ON system_settings (setting_group);
CREATE INDEX idx_system_settings_updater  ON system_settings (updated_by);

COMMIT;
