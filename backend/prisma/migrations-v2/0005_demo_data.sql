-- LaoStay · schema v2 — demo data
--
-- Enough of a working platform to sign in and see real screens: admins,
-- partners with approved properties, room types priced across 90 days of
-- inventory, past bookings with payments and reviews, and one reconciled
-- payout with its ledger entries.
--
-- **Not for production.** Every password below is public. Skip this file when
-- seeding a live database.
--
-- Passwords are bcrypt via pgcrypto, which is what the design document allows
-- ("bcrypt/argon2"). They are computed here rather than pasted as fixed hashes
-- so nobody has to trust a hash they cannot reproduce.
--
-- Re-runnable: keyed on email / natural keys, and the transactional rows are
-- cleared first so the numbers stay consistent between runs.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Clear what this file generates ──────────────────────────────────────────
-- Order matters: children before parents. Master data from 0004 is untouched.
TRUNCATE TABLE
  ledger_entries, payout_items, payouts,
  booking_cancellations, refunds, payment_events, payments,
  booking_status_logs, booking_guests, booking_items,
  review_reports, review_replies, review_images, reviews,
  coupon_usages,
  conversation_reads, message_attachments, messages, conversations,
  wishlist_items, notifications, user_device_tokens, user_agreements,
  bookings,
  room_prices, room_inventory, room_type_images, room_types,
  property_amenities, property_rules, property_images, properties,
  partner_bank_accounts, partner_documents, partners,
  login_attempts, password_reset_tokens, otp_verifications,
  user_sessions, user_profiles, users,
  audit_logs
RESTART IDENTITY CASCADE;

-- ── Admins ──────────────────────────────────────────────────────────────────
-- Password for every demo account: LaoStay@2026
WITH new_admins AS (
  INSERT INTO users (role, admin_role, email, phone, password_hash, status, is_verified)
  VALUES
    ('ADMIN', 'super_admin', 'amnuay@laostay.la', '+856 20 5511 0001',
     crypt('LaoStay@2026', gen_salt('bf', 12)), 'active', true),
    ('ADMIN', 'finance',     'bounmy@laostay.la', '+856 20 5511 0002',
     crypt('LaoStay@2026', gen_salt('bf', 12)), 'active', true),
    ('ADMIN', 'staff',       'phonsy@laostay.la', '+856 20 5511 0003',
     crypt('LaoStay@2026', gen_salt('bf', 12)), 'active', true)
  RETURNING user_id, email
)
INSERT INTO user_profiles (user_id, full_name, gender, nationality)
SELECT user_id,
       CASE email
         WHEN 'amnuay@laostay.la' THEN 'ອຳນວຍ ຈັນດາ'
         WHEN 'bounmy@laostay.la' THEN 'ບຸນມີ ສີສະຫວັນ'
         ELSE 'ພອນສີ ໄຊຍະ'
       END,
       'male', 'Lao'
FROM new_admins;

-- ── Partner accounts ────────────────────────────────────────────────────────
-- Password: Partner@2026
WITH partner_users AS (
  INSERT INTO users (role, email, phone, password_hash, status, is_verified)
  VALUES
    ('PARTNER', 'vintage@laostay.la',    '+856 20 5511 2233',
     crypt('Partner@2026', gen_salt('bf', 12)), 'active', true),
    ('PARTNER', 'homsabay@laostay.la',   '+856 20 5522 3344',
     crypt('Partner@2026', gen_salt('bf', 12)), 'active', true),
    ('PARTNER', 'mekongview@laostay.la', '+856 20 5533 4455',
     crypt('Partner@2026', gen_salt('bf', 12)), 'active', true),
    ('PARTNER', 'vangvieng@laostay.la',  '+856 20 5544 5566',
     crypt('Partner@2026', gen_salt('bf', 12)), 'active', true),
    -- Still waiting on approval, so the Approvals screen has something real.
    ('PARTNER', 'newapplicant@laostay.la', '+856 20 5555 6677',
     crypt('Partner@2026', gen_salt('bf', 12)), 'active', false)
  RETURNING user_id, email
),
profiles AS (
  INSERT INTO user_profiles (user_id, full_name, gender, nationality)
  SELECT user_id,
         CASE email
           WHEN 'vintage@laostay.la'      THEN 'ວັນນະສອນ ພິມມະສອນ'
           WHEN 'homsabay@laostay.la'     THEN 'ສີສະຫວາດ ແກ້ວມະນີ'
           WHEN 'mekongview@laostay.la'   THEN 'ຄຳແພງ ສຸວັນນະ'
           WHEN 'vangvieng@laostay.la'    THEN 'ບຸນເລີດ ວົງພະຈັນ'
           ELSE 'ດວງໃຈ ພົມມະຈັນ'
         END,
         'female', 'Lao'
  FROM partner_users
  RETURNING user_id
)
INSERT INTO partners
  (user_id, business_name, business_type, contact_phone, status, verified_at)
SELECT u.user_id,
       CASE u.email
         WHEN 'vintage@laostay.la'        THEN 'Vintage House Vientiane'
         WHEN 'homsabay@laostay.la'       THEN 'Hom Sabay Guesthouse'
         WHEN 'mekongview@laostay.la'     THEN 'Mekong View Resort'
         WHEN 'vangvieng@laostay.la'      THEN 'Vang Vieng Riverside'
         ELSE 'Dokchampa Homestay'
       END,
       'individual',
       (SELECT phone FROM users WHERE user_id = u.user_id),
       CASE WHEN u.email = 'newapplicant@laostay.la' THEN 'pending'::partner_status
            ELSE 'verified'::partner_status END,
       CASE WHEN u.email = 'newapplicant@laostay.la' THEN NULL
            ELSE now() - interval '120 days' END
FROM partner_users u;

INSERT INTO partner_bank_accounts
  (partner_id, bank_name, account_name, account_number, is_default)
SELECT p.partner_id, 'BCEL', p.business_name,
       -- Placeholder ciphertext: the real column holds an encrypted value.
       'enc:' || lpad((p.partner_id * 7919)::text, 10, '0'), true
FROM partners p
WHERE p.status = 'verified';

-- ── Customers ───────────────────────────────────────────────────────────────
-- Password: Customer@2026
WITH customer_users AS (
  INSERT INTO users (role, email, phone, password_hash, status, is_verified)
  VALUES
    ('CUSTOMER', 'souda.v@gmail.com',      '+856 20 5789 1234',
     crypt('Customer@2026', gen_salt('bf', 12)), 'active', true),
    ('CUSTOMER', 'somphone.k@gmail.com',   '+856 20 2233 8890',
     crypt('Customer@2026', gen_salt('bf', 12)), 'active', true),
    ('CUSTOMER', 'john.carter@outlook.com','+856 20 9911 2020',
     crypt('Customer@2026', gen_salt('bf', 12)), 'active', true),
    ('CUSTOMER', 'mali.x@gmail.com',       '+856 20 5566 7788',
     crypt('Customer@2026', gen_salt('bf', 12)), 'active', true),
    -- Suspended, so the guard that refuses them can be exercised.
    ('CUSTOMER', 'vilay.p@gmail.com',      '+856 20 7788 1122',
     crypt('Customer@2026', gen_salt('bf', 12)), 'suspended', true),
    ('CUSTOMER', 'lin.zhao@qq.com',        '+856 20 3344 5566',
     crypt('Customer@2026', gen_salt('bf', 12)), 'active', false)
  RETURNING user_id, email
)
INSERT INTO user_profiles (user_id, full_name, gender, nationality, tier, points)
SELECT user_id,
       CASE email
         WHEN 'souda.v@gmail.com'       THEN 'ນາງ ສຸດາ ວົງສາ'
         WHEN 'somphone.k@gmail.com'    THEN 'ທ້າວ ສົມພອນ ແກ້ວ'
         WHEN 'john.carter@outlook.com' THEN 'Mr. John Carter'
         WHEN 'mali.x@gmail.com'        THEN 'ນາງ ມະລິ ໄຊຍະ'
         WHEN 'vilay.p@gmail.com'       THEN 'ທ້າວ ວິໄລ ພົມມະ'
         ELSE 'Ms. Lin Zhao'
       END,
       CASE WHEN email IN ('souda.v@gmail.com','mali.x@gmail.com','lin.zhao@qq.com')
            THEN 'female'::gender_type ELSE 'male'::gender_type END,
       CASE WHEN email = 'john.carter@outlook.com' THEN 'British'
            WHEN email = 'lin.zhao@qq.com'         THEN 'Chinese'
            ELSE 'Lao' END,
       CASE WHEN email IN ('souda.v@gmail.com','mali.x@gmail.com') THEN 'gold' ELSE 'silver' END,
       CASE WHEN email = 'souda.v@gmail.com' THEN 2400
            WHEN email = 'mali.x@gmail.com'  THEN 1810 ELSE 420 END
FROM customer_users;

-- ── Properties ──────────────────────────────────────────────────────────────
INSERT INTO properties (
  partner_id, cancellation_policy_id, property_name, property_type, description,
  phone, province_id, district_id, address_detail, latitude, longitude, status
)
SELECT
  p.partner_id,
  (SELECT cancellation_policy_id FROM cancellation_policies
    WHERE policy_name LIKE 'ປານກາງ%' LIMIT 1),
  -- A VALUES list yields text; the enum column needs the cast spelled out.
  d.name, d.ptype::property_type, d.descr, p.contact_phone,
  (SELECT province_id FROM provinces WHERE province_code = d.prov),
  (SELECT dd.district_id FROM districts dd
     JOIN provinces pp ON pp.province_id = dd.province_id
    WHERE pp.province_code = d.prov AND dd.district_code = d.dist),
  d.addr, d.lat, d.lng, 'active'
FROM partners p
JOIN (VALUES
  ('Vintage House Vientiane', 'Vintage House Vientiane', 'guesthouse',
   'ເຮືອນພັກສະໄໝເກົ່າ ໃຈກາງນະຄອນຫຼວງ ຍ່າງໄປຕະຫຼາດເຊົ້າໄດ້',
   'VT', 'VT-01', 'ບ້ານຫັດສະດີ ເມືອງຈັນທະບູລີ', 17.9668, 102.6100),
  ('Hom Sabay Guesthouse',    'Hom Sabay Guesthouse', 'homestay',
   'ໂຮມສະເຕແບບລາວ ບັນຍາກາດຄອບຄົວ ໃກ້ວັດຊຽງທອງ',
   'LP', 'LP-01', 'ບ້ານຊຽງທອງ ເມືອງຫຼວງພະບາງ', 19.8925, 102.1400),
  ('Mekong View Resort',      'Mekong View Resort', 'resort',
   'ຣີສອດຕິດແມ່ນ້ຳຂອງ ວິວພະອາທິດຕົກ ສະລອຍນ້ຳກາງແຈ້ງ',
   'CH', 'CH-01', 'ບ້ານໂພນສະຫວັນ ເມືອງປາກເຊ', 15.1200, 105.7990),
  ('Vang Vieng Riverside',    'Vang Vieng Riverside', 'villa',
   'ວິນລ່າລິມນ້ຳຊອງ ວິວພູຫິນປູນ ເໝາະສຳລັບຄອບຄົວ',
   'VI', 'VI-05', 'ບ້ານສະຫວ່າງ ເມືອງວັງວຽງ', 18.9236, 102.4480),
  ('Dokchampa Homestay',      'Dokchampa Homestay', 'homestay',
   'ໂຮມສະເຕນ້ອຍ ສະຫງົບ ເໝາະສຳລັບນັກເດີນທາງຄົນດຽວ',
   'VT', 'VT-03', 'ບ້ານໂພນສີນວນ ເມືອງໄຊເສດຖາ', 17.9750, 102.6300)
) AS d(biz, name, ptype, descr, prov, dist, addr, lat, lng)
  ON d.biz = p.business_name;

-- Every property gets the common amenities; the resort and villa get the rest.
INSERT INTO property_amenities (property_id, amenity_id)
SELECT pr.property_id, a.amenity_id
FROM properties pr
JOIN amenities a ON a.amenity_name_en IN
  ('Free WiFi', 'Parking', 'Air conditioning', 'Hot water', 'Towels', 'Breakfast')
ON CONFLICT DO NOTHING;

INSERT INTO property_amenities (property_id, amenity_id)
SELECT pr.property_id, a.amenity_id
FROM properties pr
JOIN amenities a ON a.amenity_name_en IN
  ('Swimming pool', 'Restaurant', 'Bar', 'Garden', 'Airport shuttle', 'Spa')
WHERE pr.property_type IN ('resort', 'villa')
ON CONFLICT DO NOTHING;

INSERT INTO property_rules
  (property_id, check_in_from, check_out_until, smoking_allowed, pet_allowed,
   child_allowed, party_allowed, quiet_hours_start, quiet_hours_end)
SELECT property_id, '14:00', '12:00', false,
       property_type IN ('villa', 'homestay'), true, false, '22:00', '07:00'
FROM properties;

-- ── Room types ──────────────────────────────────────────────────────────────
INSERT INTO room_types (
  property_id, type_name, description, bed_type, has_ac, max_occupancy,
  base_price, total_rooms, min_nights, extra_guest_fee
)
SELECT pr.property_id, r.type_name, r.descr, r.bed::bed_type, r.ac,
       r.occ, r.price, r.rooms, r.min_n, r.extra
FROM properties pr
JOIN (VALUES
  ('Standard Fan',   'ຫ້ອງມາດຕະຖານ ພັດລົມ ຫ້ອງນ້ຳໃນຕົວ',      'single', false, 2,  320000,  6, 1, 50000),
  ('Standard AC',    'ຫ້ອງມາດຕະຖານ ມີແອ ຫ້ອງນ້ຳໃນຕົວ',        'double', true,  2,  450000,  8, 1, 60000),
  ('Deluxe',         'ຫ້ອງກວ້າງ ມີລະບຽງ ວິວສວນ',              'double', true,  3,  620000,  4, 1, 80000),
  ('Family Suite',   'ຫ້ອງຄອບຄົວ 2 ຫ້ອງນອນ ມີຄົວນ້ອຍ',       'twin',   true,  5,  980000,  2, 2, 100000)
) AS r(type_name, descr, bed, ac, occ, price, rooms, min_n, extra) ON true;

-- ── Inventory and prices · 90 days forward ─────────────────────────────────
-- Every night on sale, so search has something to return from day one.
INSERT INTO room_inventory (room_type_id, date, total_count, held_count, booked_count, status)
SELECT rt.room_type_id, d::date, rt.total_rooms, 0, 0, 'open'
FROM room_types rt
CROSS JOIN generate_series(CURRENT_DATE, CURRENT_DATE + 89, '1 day') AS d
ON CONFLICT (room_type_id, date) DO NOTHING;

-- Friday and Saturday cost 15% more; the rest sit at the base price.
INSERT INTO room_prices (room_type_id, date, price, price_type)
SELECT rt.room_type_id, d::date,
       CASE WHEN EXTRACT(ISODOW FROM d) IN (5, 6)
            THEN round(rt.base_price * 1.15)::bigint
            ELSE rt.base_price END,
       CASE WHEN EXTRACT(ISODOW FROM d) IN (5, 6)
            THEN 'weekend'::price_type ELSE 'weekday'::price_type END
FROM room_types rt
CROSS JOIN generate_series(CURRENT_DATE, CURRENT_DATE + 89, '1 day') AS d
ON CONFLICT (room_type_id, date) DO NOTHING;

-- ── Bookings ────────────────────────────────────────────────────────────────
-- 60 stays spread over the last 90 days and the next 30, so the dashboard,
-- the calendar and the payout screen all have real curves. Deterministic:
-- everything derives from the row number, not from random().
WITH scaffold AS (
  SELECT
    n,
    (SELECT rt.room_type_id FROM room_types rt ORDER BY rt.room_type_id
      OFFSET (n * 7) % (SELECT count(*) FROM room_types) LIMIT 1) AS room_type_id,
    (SELECT u.user_id FROM users u WHERE u.role = 'CUSTOMER' AND u.status = 'active'
      ORDER BY u.user_id OFFSET (n * 3) % 5 LIMIT 1)              AS customer_id,
    (CURRENT_DATE - 90 + (n * 2))::date                            AS check_in,
    1 + (n % 4)                                                    AS nights
  FROM generate_series(0, 59) AS n
),
priced AS (
  -- `s.*` already carries base_price_calc; naming it again would produce two
  -- columns with the same name and break the outer reference.
  SELECT s.*,
         rt.property_id,
         rt.base_price,
         (s.check_in + s.nights)::date AS check_out,
         p.default_commission_rate
  FROM (
    SELECT s.*, (SELECT rt2.base_price FROM room_types rt2
                  WHERE rt2.room_type_id = s.room_type_id) * s.nights AS base_price_calc
    FROM scaffold s
  ) s
  JOIN room_types rt ON rt.room_type_id = s.room_type_id
  JOIN properties pr ON pr.property_id = rt.property_id
  JOIN partners   p  ON p.partner_id   = pr.partner_id
),
computed AS (
  SELECT
    p.*,
    p.base_price_calc                                   AS subtotal_amount,
    round(p.base_price_calc * 0.05)::bigint             AS service_fee,
    p.base_price_calc + round(p.base_price_calc * 0.05)::bigint AS total_amount,
    -- Status follows the calendar: past stays are completed, one in eight was
    -- cancelled, and anything in the future is confirmed.
    CASE
      WHEN p.n % 8 = 3                                   THEN 'cancelled'::booking_status
      WHEN (p.check_in + p.nights) < CURRENT_DATE        THEN 'completed'::booking_status
      WHEN p.check_in <= CURRENT_DATE                    THEN 'staying'::booking_status
      ELSE 'confirmed'::booking_status
    END AS status
  FROM priced p
),
-- Walk-in or app is decided once, here, and everything downstream reads from
-- these columns. Working it out again per column is how commission ended up
-- charged on a service fee a walk-in never paid.
charged AS (
  SELECT c.*,
         (c.n % 5 = 0)                                                  AS is_walk_in,
         -- A walk-in is paid at the desk: no platform service fee, and the
         -- lower commission rate.
         CASE WHEN c.n % 5 = 0 THEN 0 ELSE c.service_fee END            AS fee_charged,
         CASE WHEN c.n % 5 = 0 THEN c.subtotal_amount
              ELSE c.total_amount END                                   AS total_charged,
         CASE WHEN c.n % 5 = 0 THEN 2.50 ELSE 5.00 END                  AS rate
  FROM computed c
),
final AS (
  SELECT ch.*,
         round(ch.total_charged * ch.rate / 100)::bigint AS commission
  FROM charged ch
)
INSERT INTO bookings (
  booking_code, customer_id, property_id, cancellation_policy_id, source,
  check_in, check_out, nights, total_guests,
  subtotal_amount, service_fee, commission_rate, commission_amount,
  total_amount, payout_amount, status, idempotency_key, created_at
)
SELECT
  'STL-' || upper(lpad(to_hex(1000 + f.n), 4, '0')),
  f.customer_id, f.property_id,
  (SELECT cancellation_policy_id FROM cancellation_policies
    WHERE policy_name LIKE 'ປານກາງ%' LIMIT 1),
  CASE WHEN f.is_walk_in THEN 'walk_in'::booking_source ELSE 'app'::booking_source END,
  f.check_in, f.check_out, f.nights, 1 + (f.n % 3),
  f.subtotal_amount,
  f.fee_charged,
  f.rate,
  f.commission,
  f.total_charged,
  -- Derived by subtraction, never computed a second way: `bookings_payout_balances`
  -- rejects the row otherwise.
  f.total_charged - f.commission,
  f.status,
  'seed:' || f.n,
  (now() - ((90 - f.n) || ' days')::interval)
FROM final f;

-- One line item per booking, snapshotting the nightly rate.
INSERT INTO booking_items
  (booking_id, room_type_id, quantity, nights, price_per_night, subtotal)
SELECT b.booking_id, rt.room_type_id, 1, b.nights, rt.base_price, b.subtotal_amount
FROM bookings b
JOIN properties pr ON pr.property_id = b.property_id
JOIN room_types rt ON rt.property_id = pr.property_id
WHERE rt.room_type_id = (
  SELECT rt2.room_type_id FROM room_types rt2
  WHERE rt2.property_id = b.property_id ORDER BY rt2.room_type_id LIMIT 1);

INSERT INTO booking_guests (booking_id, full_name, guest_type, is_primary)
SELECT b.booking_id, up.full_name, 'adult', true
FROM bookings b
JOIN user_profiles up ON up.user_id = b.customer_id;

-- Hold the nights that live bookings occupy, so the calendar tells the truth.
UPDATE room_inventory ri
SET booked_count = ri.booked_count + occupied.n
FROM (
  SELECT bi.room_type_id, gs::date AS date, count(*)::int AS n
  FROM bookings b
  JOIN booking_items bi ON bi.booking_id = b.booking_id
  CROSS JOIN LATERAL generate_series(b.check_in, b.check_out - 1, '1 day') AS gs
  WHERE b.status <> 'cancelled'
  GROUP BY bi.room_type_id, gs
) AS occupied
WHERE ri.room_type_id = occupied.room_type_id
  AND ri.date = occupied.date
  -- Never write past the overbook CHECK; the seed's spread can collide.
  AND ri.booked_count + occupied.n <= ri.total_count;

-- ── Payments ────────────────────────────────────────────────────────────────
INSERT INTO payments
  (booking_id, idempotency_key, amount, status, txn_ref, paid_at, qr_payload)
SELECT b.booking_id, 'pay:' || b.booking_id, b.total_amount,
       CASE b.status
         WHEN 'cancelled' THEN 'refunded'::payment_status
         ELSE 'paid'::payment_status
       END,
       'PJ' || lpad(b.booking_id::text, 10, '0'),
       b.created_at + interval '4 minutes',
       '00020101021230' || lpad(b.booking_id::text, 8, '0') || '53034185802LA'
FROM bookings b
WHERE b.source = 'app';

-- ── Cancellations and refunds ───────────────────────────────────────────────
WITH cancelled AS (
  SELECT b.booking_id, b.total_amount, p.payment_id
  FROM bookings b
  JOIN payments p ON p.booking_id = b.booking_id
  WHERE b.status = 'cancelled'
),
made_refunds AS (
  INSERT INTO refunds (payment_id, booking_id, amount, reason, status, txn_ref, refunded_at)
  SELECT c.payment_id, c.booking_id,
         -- The moderate policy keeps 30%.
         c.total_amount - round(c.total_amount * 0.30)::bigint,
         'ຍົກເລີກໂດຍແຂກ', 'completed',
         'RF' || lpad(c.booking_id::text, 10, '0'), now() - interval '10 days'
  FROM cancelled c
  RETURNING refund_id, booking_id, amount
)
INSERT INTO booking_cancellations
  (booking_id, reason, policy_snapshot, penalty_amount, refund_amount, refund_id)
SELECT r.booking_id, 'ປ່ຽນແຜນການເດີນທາງ',
       jsonb_build_object('policy', 'ປານກາງ · Moderate',
                          'days_before_checkin', 5, 'penalty_percent', 30),
       c.total_amount - r.amount, r.amount, r.refund_id
FROM made_refunds r
JOIN cancelled c ON c.booking_id = r.booking_id;

-- ── Reviews ─────────────────────────────────────────────────────────────────
-- Only on completed stays, one per booking — the trigger recomputes
-- properties.rating_avg from these.
INSERT INTO reviews (
  booking_id, customer_id, property_id, overall_rating,
  cleanliness_rating, service_rating, value_rating, title, comment, status
)
SELECT b.booking_id, b.customer_id, b.property_id,
       t.stars, t.stars::int, t.stars::int, t.stars::int, t.title, t.body, 'published'
FROM bookings b
JOIN LATERAL (
  SELECT * FROM (VALUES
    (5.0, 'ດີເກີນຄາດ',      'ທີ່ພັກສະອາດ ເຈົ້າພາບໃຈດີຫຼາຍ ວິວງາມ ຈະກັບມາອີກແນ່ນອນ.'),
    (4.0, 'ຕຳແໜ່ງດີ',      'ໃກ້ຕົວເມືອງ ເດີນທາງສະດວກ ພຽງແຕ່ WiFi ຊ້າໜ້ອຍໜຶ່ງ.'),
    (5.0, 'ຄຸ້ມຄ່າຫຼາຍ',    'ອາຫານເຊົ້າແຊບ ບ່ອນຈອດລົດກວ້າງ ພະນັກງານເປັນກັນເອງ.'),
    (3.0, 'ພໍໃຊ້ໄດ້',       'ຫ້ອງສະອາດ ແຕ່ນ້ຳຮ້ອນມາຊ້າ ຕອນເຊົ້າຄົນເຍอะ.'),
    (4.0, 'ສະຫງົບດີ',      'ເໝາະສຳລັບພັກຜ່ອນ ບໍ່ມີສຽງລົບກວນ ຫ້ອງນ້ຳສະອາດ.')
  ) AS v(stars, title, body)
  OFFSET (b.booking_id % 5) LIMIT 1
) AS t ON true
WHERE b.status = 'completed' AND b.booking_id % 2 = 0;

-- ── Payout · one reconciled week ────────────────────────────────────────────
WITH week_bounds AS (
  -- date_trunc yields a timestamp, and `timestamp + 6` is not valid. Cast to
  -- date once here so the rest of the query does plain day arithmetic.
  SELECT date_trunc('week', CURRENT_DATE - 14)::date AS week_start
),
weekly AS (
  SELECT
    pr.partner_id,
    wb.week_start          AS period_start,
    (wb.week_start + 6)    AS period_end,
    b.booking_id,
    b.total_amount         AS gross,
    b.commission_amount    AS commission
  FROM week_bounds wb
  JOIN bookings   b  ON b.check_out >= wb.week_start
                    AND b.check_out <  wb.week_start + 7
                    AND b.status = 'completed'
  JOIN properties pr ON pr.property_id = b.property_id
),
totals AS (
  SELECT partner_id, period_start, period_end,
         sum(gross)::bigint      AS gross_amount,
         sum(commission)::bigint AS commission_amount
  FROM weekly GROUP BY partner_id, period_start, period_end
),
made_payouts AS (
  INSERT INTO payouts (
    partner_id, bank_account_id, period_start, period_end,
    gross_amount, commission_amount, net_amount, status
  )
  SELECT t.partner_id,
         (SELECT bank_account_id FROM partner_bank_accounts ba
           WHERE ba.partner_id = t.partner_id LIMIT 1),
         t.period_start, t.period_end,
         t.gross_amount, t.commission_amount,
         t.gross_amount - t.commission_amount,
         'pending'
  FROM totals t
  RETURNING payout_id, partner_id
)
INSERT INTO payout_items
  (payout_id, booking_id, gross_amount, commission_amount, net_amount)
SELECT mp.payout_id, w.booking_id, w.gross, w.commission, w.gross - w.commission
FROM made_payouts mp
JOIN weekly w ON w.partner_id = mp.partner_id
ON CONFLICT (payout_id, booking_id) DO NOTHING;

-- ── Ledger ──────────────────────────────────────────────────────────────────
-- Two entries per paid booking: what the guest paid in, and the commission the
-- platform took out.
INSERT INTO ledger_entries
  (entry_type, booking_id, partner_id, reference_type, reference_id,
   direction, amount, note, created_at)
SELECT 'charge', b.booking_id, pr.partner_id, 'payment', p.payment_id,
       'credit', p.amount, 'ຮັບຊຳລະຈາກແຂກ', p.paid_at
FROM bookings b
JOIN payments   p  ON p.booking_id  = b.booking_id AND p.status = 'paid'
JOIN properties pr ON pr.property_id = b.property_id;

INSERT INTO ledger_entries
  (entry_type, booking_id, partner_id, reference_type, reference_id,
   direction, amount, note, created_at)
SELECT 'commission', b.booking_id, pr.partner_id, 'booking', b.booking_id,
       'debit', b.commission_amount, 'ຄ່າຄອມມິຊຊັນແພລດຟອມ', p.paid_at
FROM bookings b
JOIN payments   p  ON p.booking_id  = b.booking_id AND p.status = 'paid'
JOIN properties pr ON pr.property_id = b.property_id
WHERE b.commission_amount > 0;

INSERT INTO ledger_entries
  (entry_type, booking_id, partner_id, reference_type, reference_id,
   direction, amount, note, created_at)
SELECT 'refund', r.booking_id, pr.partner_id, 'refund', r.refund_id,
       'debit', r.amount, 'ຄືນເງິນໃຫ້ແຂກ', r.refunded_at
FROM refunds r
JOIN bookings   b  ON b.booking_id  = r.booking_id
JOIN properties pr ON pr.property_id = b.property_id;

-- ── Chat, wishlist, notifications ───────────────────────────────────────────
WITH convo AS (
  INSERT INTO conversations (customer_id, property_id, booking_id, status)
  SELECT b.customer_id, b.property_id, b.booking_id, 'open'
  FROM bookings b
  WHERE b.status IN ('confirmed', 'staying')
  ORDER BY b.booking_id
  LIMIT 6
  RETURNING conversation_id, customer_id, property_id
)
INSERT INTO messages (conversation_id, sender_id, message_type, message_text, created_at)
SELECT c.conversation_id, s.sender, 'text', s.body,
       now() - ((6 - s.ord) || ' hours')::interval
FROM convo c
CROSS JOIN LATERAL (VALUES
  (1, c.customer_id, 'ສະບາຍດີ ຂ້ອຍຈະໄປຮອດປະມານ 20:00 ໄດ້ບໍ?'),
  (2, (SELECT p.user_id FROM properties pr
        JOIN partners p ON p.partner_id = pr.partner_id
       WHERE pr.property_id = c.property_id),
      'ໄດ້ເລີຍ ພວກເຮົາມີພະນັກງານຢູ່ຮອດ 23:00 ຄັບ'),
  (3, c.customer_id, 'ຂອບໃຈຫຼາຍ ມີບ່ອນຈອດລົດບໍ?'),
  (4, (SELECT p.user_id FROM properties pr
        JOIN partners p ON p.partner_id = pr.partner_id
       WHERE pr.property_id = c.property_id),
      'ມີຄັບ ຈອດໄດ້ຟຣີໜ້າທີ່ພັກ')
) AS s(ord, sender, body);

INSERT INTO wishlist_items (user_id, property_id)
SELECT u.user_id, pr.property_id
FROM users u
CROSS JOIN properties pr
WHERE u.role = 'CUSTOMER' AND u.status = 'active'
  AND (u.user_id + pr.property_id) % 4 = 0
ON CONFLICT DO NOTHING;

INSERT INTO notifications (user_id, title, message, notification_type, reference_type, reference_id)
SELECT b.customer_id, 'ການຈອງຢືນຢັນແລ້ວ',
       'ການຈອງ ' || b.booking_code || ' ຂອງທ່ານຢືນຢັນແລ້ວ',
       'booking', 'booking', b.booking_id
FROM bookings b
WHERE b.status = 'confirmed';

INSERT INTO notifications (user_id, title, message, notification_type, reference_type, reference_id)
SELECT p.user_id, 'ມີການຈອງໃໝ່',
       b.booking_code || ' · ' || b.nights || ' ຄືນ',
       'booking', 'booking', b.booking_id
FROM bookings b
JOIN properties pr ON pr.property_id = b.property_id
JOIN partners   p  ON p.partner_id   = pr.partner_id
WHERE b.status IN ('confirmed', 'staying');

-- ── Terms acceptance ────────────────────────────────────────────────────────
INSERT INTO user_agreements (user_id, document_type, version, ip_address)
SELECT user_id, 'terms', '1.0', '127.0.0.1' FROM users WHERE role <> 'ADMIN';

COMMIT;
