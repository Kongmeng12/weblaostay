-- LaoStay · schema v2 — settings & CMS content
--
-- Split out of 0004 on purpose. Every table here carries `updated_by` or
-- `created_by` referencing `users`, and 0005 truncates `users` with CASCADE —
-- which silently truncates these too. Loading them after the demo data is what
-- keeps them populated.
--
-- Idempotent, keyed on setting_key / page_slug.

BEGIN;

-- ── System settings ─────────────────────────────────────────────────────────
-- Technical knobs the pricing, payout and booking code reads. `data_type` says
-- how to parse `setting_value`, which is text for everything.
INSERT INTO system_settings (setting_group, setting_key, setting_value, data_type, description) VALUES
  ('commission', 'commission_rate_app',       '5',    'int',
   'ຄ່າຄອມມິຊຊັນຈາກການຈອງຜ່ານແອັບ (%)'),
  ('commission', 'commission_rate_walkin',    '2.5',  'string',
   'ຄ່າຄອມມິຊຊັນຈາກ walk-in ທີ່ partner ບັນທຶກເອງ (%)'),
  ('booking',    'service_fee_rate',          '5',    'int',
   'ຄ່າບໍລິການທີ່ບວກເທິງຄ່າຫ້ອງ ແລະ ສະແດງໃຫ້ແຂກເຫັນ (%)'),
  ('booking',    'tax_rate',                  '0',    'int',
   'ອັດຕາອາກອນ (%) — 0 ຈົນກວ່າຈະຢືນຢັນກັບພາສີ'),
  -- The hold is what keeps a dropped checkout from blocking a room forever.
  ('booking',    'hold_ttl_minutes',          '15',   'int',
   'ຈອງແບບ pending ຄ້າງໄວ້ໄດ້ຈັກນາທີ ກ່ອນຄືນຫ້ອງເຂົ້າຄັງ'),
  ('booking',    'max_nights_per_booking',    '60',   'int',
   'ຈຳນວນຄືນສູງສຸດຕໍ່ 1 ການຈອງ'),
  ('booking',    'default_min_nights',        '1',    'int',
   'ຈຳນວນຄືນຂັ້ນຕ່ຳ ເມື່ອ room_type ບໍ່ໄດ້ກຳນົດເອງ'),
  ('payment',    'payment_provider',          'simulated', 'string',
   'simulated ຫຼື phajay'),
  ('payment',    'qr_ttl_minutes',            '15',   'int',
   'QR ຢູ່ໄດ້ຈັກນາທີ ກ່ອນໝົດອາຍຸ'),
  ('payout',     'payout_period_days',        '7',    'int',
   'ຄວາມຖີ່ຂອງຮອບໂອນເງິນ (ວັນ)'),
  ('auth',       'otp_ttl_minutes',           '5',    'int',
   'OTP ໝົດອາຍຸໃນຈັກນາທີ'),
  ('auth',       'otp_max_attempts',          '5',    'int',
   'ກรอก OTP ຜິດໄດ້ຈັກຄັ້ງ'),
  ('auth',       'password_reset_ttl_minutes','30',   'int',
   'ລິ້ງຕັ້ງລະຫັດຜ່ານໃໝ່ ໝົດອາຍຸໃນຈັກນາທີ'),
  ('auth',       'login_max_attempts',        '5',    'int',
   'ລັອກອິນຜິດໄດ້ຈັກຄັ້ງ ກ່ອນລັອກ'),
  ('auth',       'login_lockout_minutes',     '15',   'int',
   'ລັອກດົນເທົ່າໃດ ຫຼັງຜິດຄົບຈຳນວນ'),
  ('auth',       'access_token_ttl',          '15m',  'string',
   'ອາຍຸ access token'),
  ('auth',       'refresh_token_ttl',         '7d',   'string',
   'ອາຍຸ refresh token'),
  ('upload',     'max_image_mb',              '5',    'int',
   'ຂະໜາດຮູບສູງສຸດ (MB)'),
  ('upload',     'max_images_per_property',   '12',   'int',
   'ຈຳນວນຮູບສູງສຸດຕໍ່ທີ່ພັກ')
ON CONFLICT (setting_key) DO NOTHING;

-- ── App settings (user-facing / CMS) ────────────────────────────────────────
INSERT INTO app_settings (setting_key, setting_value, description) VALUES
  ('platform_name',    'LaoStay · ພັກເຮືອນລາວ', 'ຊື່ແພລດຟອມທີ່ສະແດງໃນແອັບ'),
  ('contact_email',    'support@laostay.la',      'ອີເມວຝ່າຍຊ່ວຍເຫຼືອ'),
  ('contact_phone',    '+856 20 5555 0000',       'ເບີໂທຝ່າຍຊ່ວຍເຫຼືອ'),
  ('default_currency', 'LAK',                     'ສະກຸນເງິນ'),
  ('default_language', 'lo',                      'ພາສາເລີ່ມຕົ້ນ')
ON CONFLICT (setting_key) DO NOTHING;

-- ── Notification templates ──────────────────────────────────────────────────
-- Placeholders are {{name}} and are filled by the notification service.
INSERT INTO notification_templates
  (template_code, title_template, message_template, notification_type) VALUES
  ('booking_created',   'ມີການຈອງໃໝ່',
   '{{booking_code}} · {{nights}} ຄືນ · {{total}}', 'booking'),
  ('booking_confirmed', 'ການຈອງຢືນຢັນແລ້ວ',
   'ການຈອງ {{booking_code}} ຂອງທ່ານຢືນຢັນແລ້ວ', 'booking'),
  ('booking_cancelled', 'ການຈອງຖືກຍົກເລີກ',
   'ການຈອງ {{booking_code}} ຖືກຍົກເລີກ · ຄືນເງິນ {{refund}}', 'booking'),
  ('booking_reminder',  'ໃກ້ຮອດວັນເຂົ້າພັກ',
   'ອີກ {{days}} ວັນ ຈະຮອດວັນເຂົ້າພັກ {{property}}', 'booking'),
  ('payment_received',  'ຊຳລະສຳເລັດ',
   '{{booking_code}} · {{amount}} · {{property}}', 'payment'),
  ('payment_expired',   'QR ໝົດອາຍຸ',
   'QR ຂອງການຈອງ {{booking_code}} ໝົດອາຍຸແລ້ວ ກະລຸນາສ້າງໃໝ່', 'payment'),
  ('refund_completed',  'ຄືນເງິນສຳເລັດ',
   'ຄືນເງິນ {{amount}} ສຳລັບການຈອງ {{booking_code}} ແລ້ວ', 'payment'),
  ('payout_paid',       'ໂອນເງິນສຳເລັດ',
   'ໂອນ {{amount}} ເຂົ້າບັນຊີ {{bank}} ແລ້ວ', 'payment'),
  ('partner_approved',  'ອະນຸມັດແລ້ວ! 🎉',
   'ໃບສະໝັກທີ່ພັກຂອງທ່ານຜ່ານການອະນຸມັດ — ເລີ່ມຮັບການຈອງໄດ້ເລີຍ', 'system'),
  ('partner_rejected',  'ໃບສະໝັກບໍ່ຜ່ານ',
   'ໃບສະໝັກຂອງທ່ານຍັງບໍ່ຜ່ານ ກະລຸນາຕິດຕໍ່ຝ່າຍຊ່ວຍເຫຼືອ', 'system'),
  ('review_received',   'ມີຮີວິວໃໝ່',
   '{{booking_code}} · {{stars}} ດາວ', 'review'),
  ('new_message',       'ມີຂໍ້ຄວາມໃໝ່',
   '{{sender}}: {{preview}}', 'system')
ON CONFLICT (template_code) DO NOTHING;

-- ── CMS pages ───────────────────────────────────────────────────────────────
-- Placeholder bodies. Legal text must be supplied before go-live; shipping
-- lorem ipsum as terms is worse than shipping no page at all.
INSERT INTO app_pages (page_slug, title, content, is_active) VALUES
  ('terms',   'ເງື່ອນໄຂການໃຊ້ບໍລິການ',
   '<p>ຍັງບໍ່ໄດ້ຕື່ມເນື້ອຫາ — ຕ້ອງໃສ່ຂໍ້ຄວາມທາງກົດໝາຍກ່ອນເປີດໃຊ້ຈິງ.</p>', false),
  ('privacy', 'ນະໂຍບາຍຄວາມເປັນສ່ວນຕົວ',
   '<p>ຍັງບໍ່ໄດ້ຕື່ມເນື້ອຫາ — ຕ້ອງໃສ່ຂໍ້ຄວາມທາງກົດໝາຍກ່ອນເປີດໃຊ້ຈິງ.</p>', false),
  ('partner_agreement', 'ສັນຍາຄູ່ຮ່ວມທຸລະກິດ',
   '<p>ຍັງບໍ່ໄດ້ຕື່ມເນື້ອຫາ — ຕ້ອງໃສ່ຂໍ້ຄວາມທາງກົດໝາຍກ່ອນເປີດໃຊ້ຈິງ.</p>', false),
  ('about',   'ກ່ຽວກັບ LaoStay',
   '<p>LaoStay — ແພລດຟອມຈອງທີ່ພັກລາວ.</p>', true)
ON CONFLICT (page_slug) DO NOTHING;

-- ── FAQs ────────────────────────────────────────────────────────────────────
INSERT INTO faqs (category, question, answer, display_order) VALUES
  ('ການຈອງ', 'ຈອງແລ້ວຈ່າຍເງິນແນວໃດ?',
   'ຫຼັງກົດຈອງ ລະບົບຈະສ້າງ QR PhaJay ໃຫ້ — ສະແກນຈ່າຍຜ່ານແອັບທະນາຄານ. QR ມີອາຍຸ 15 ນາທີ.', 1),
  ('ການຈອງ', 'ຍົກເລີກການຈອງໄດ້ບໍ?',
   'ໄດ້ — ຄ່າທຳນຽມຂຶ້ນກັບນະໂຍບາຍຂອງແຕ່ລະທີ່ພັກ ເຊິ່ງສະແດງໄວ້ກ່ອນຢືນຢັນການຈອງ.', 2),
  ('ການຈອງ', 'ຈ່າຍແລ້ວແຕ່ບໍ່ໄດ້ຮັບການຢືນຢັນ?',
   'ລໍ 1–2 ນາທີ ໃຫ້ທະນາຄານແຈ້ງກັບມາ. ຖ້າຍັງບໍ່ໄດ້ ຕິດຕໍ່ຝ່າຍຊ່ວຍເຫຼືອພ້ອມລະຫັດການຈອງ.', 3),
  ('ການຊຳລະ', 'ຄືນເງິນໃຊ້ເວລາດົນປານໃດ?',
   'ປົກກະຕິ 3–7 ວັນລັດຖະການ ຂຶ້ນກັບທະນາຄານ.', 4),
  ('Partner', 'ຈະລົງທະບຽນທີ່ພັກແນວໃດ?',
   'ດາວໂຫຼດແອັບ LaoStay Partner ແລ້ວກົດ "ສະໝັກເປັນ Partner". ທີມງານຈະກວດສອບເອກະສານກ່ອນອະນຸມັດ.', 5),
  ('Partner', 'ຄ່າຄອມມິຊຊັນເທົ່າໃດ?',
   'ຈອງຜ່ານແອັບ 5% · walk-in ທີ່ບັນທຶກເອງ 2.5%.', 6),
  ('Partner', 'ໄດ້ຮັບເງິນເມື່ອໃດ?',
   'ໂອນເປັນຮອບທຸກອາທິດ ຫຼັງແຂກເຊັກເອົາແລ້ວ.', 7)
ON CONFLICT DO NOTHING;

COMMIT;
