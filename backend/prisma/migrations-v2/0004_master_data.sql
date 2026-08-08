-- LaoStay · schema v2 — master / reference data
--
-- Reference rows that stand on their own: administrative areas, the amenity
-- vocabulary, cancellation policies and notification templates. No demo
-- content — that lives in 0005_demo_data.sql, which production skips.
--
-- Everything here is free of foreign keys to `users`, and that is deliberate.
-- 0005 truncates `users` with CASCADE, which also truncates every table
-- holding an FK to it — so settings and CMS pages, which carry `updated_by`,
-- live in 0006 and are loaded after the demo data instead.
--
-- Idempotent: every insert is ON CONFLICT DO NOTHING against a natural key, so
-- re-running adds what is missing and changes nothing else.

BEGIN;

-- ── Provinces ───────────────────────────────────────────────────────────────
-- All 18, with their ISO 3166-2:LA codes.
INSERT INTO provinces (province_code, province_name_lo, province_name_en) VALUES
  ('VT', 'ນະຄອນຫຼວງວຽງຈັນ', 'Vientiane Capital'),
  ('PH', 'ຜົ້ງສາລີ',        'Phongsaly'),
  ('LM', 'ຫຼວງນ້ຳທາ',       'Luang Namtha'),
  ('OU', 'ອຸດົມໄຊ',         'Oudomxay'),
  ('BK', 'ບໍ່ແກ້ວ',          'Bokeo'),
  ('LP', 'ຫຼວງພະບາງ',       'Luang Prabang'),
  ('HO', 'ຫົວພັນ',          'Houaphanh'),
  ('XA', 'ໄຊຍະບູລີ',        'Xayaboury'),
  ('XI', 'ຊຽງຂວາງ',        'Xiengkhouang'),
  ('VI', 'ວຽງຈັນ',          'Vientiane Province'),
  ('BL', 'ບໍລິຄຳໄຊ',        'Bolikhamxay'),
  ('KH', 'ຄຳມ່ວນ',          'Khammouane'),
  ('SV', 'ສະຫວັນນະເຂດ',     'Savannakhet'),
  ('SL', 'ສາລະວັນ',         'Saravane'),
  ('XE', 'ເຊກອງ',          'Sekong'),
  ('CH', 'ຈຳປາສັກ',        'Champasak'),
  ('AT', 'ອັດຕະປື',         'Attapeu'),
  ('XS', 'ໄຊສົມບູນ',        'Xaysomboun')
ON CONFLICT (province_code) DO NOTHING;

-- ── Districts ───────────────────────────────────────────────────────────────
-- The four provinces that carry almost all tourism, complete; plus the
-- district that each remaining province is reached through.
--
-- Laos has ~148 districts in total. The rest should be loaded from the
-- official Ministry of Home Affairs list before go-live — a guessed district
-- name is worse than an absent one, because an address built on it looks
-- correct and is not.

-- Vientiane Capital · 9
INSERT INTO districts (province_id, district_code, district_name_lo, district_name_en)
SELECT p.province_id, d.code, d.lo, d.en
FROM provinces p, (VALUES
  ('VT-01', 'ຈັນທະບູລີ',    'Chanthabouly'),
  ('VT-02', 'ສີໂຄດຕະບອງ',  'Sikhottabong'),
  ('VT-03', 'ໄຊເສດຖາ',     'Xaysetha'),
  ('VT-04', 'ສີສັດຕະນາກ',   'Sisattanak'),
  ('VT-05', 'ນາຊາຍທອງ',    'Naxaithong'),
  ('VT-06', 'ໄຊທານີ',       'Xaythany'),
  ('VT-07', 'ຫາດຊາຍຟອງ',  'Hadxaifong'),
  ('VT-08', 'ສັງທອງ',       'Sangthong'),
  ('VT-09', 'ປາກງື່ມ',      'Parkngum')
) AS d(code, lo, en)
WHERE p.province_code = 'VT'
ON CONFLICT (province_id, district_code) DO NOTHING;

-- Luang Prabang · 12
INSERT INTO districts (province_id, district_code, district_name_lo, district_name_en)
SELECT p.province_id, d.code, d.lo, d.en
FROM provinces p, (VALUES
  ('LP-01', 'ຫຼວງພະບາງ', 'Luang Prabang'),
  ('LP-02', 'ຊຽງເງິນ',    'Xieng Ngeun'),
  ('LP-03', 'ນານ',        'Nan'),
  ('LP-04', 'ປາກອູ',      'Park Ou'),
  ('LP-05', 'ນ້ຳບາກ',     'Nambak'),
  ('LP-06', 'ງອຍ',        'Ngoi'),
  ('LP-07', 'ປາກແຊງ',    'Pak Xeng'),
  ('LP-08', 'ໂພນໄຊ',      'Phonxay'),
  ('LP-09', 'ຈອມເພັດ',    'Chomphet'),
  ('LP-10', 'ວຽງຄຳ',      'Viengkham'),
  ('LP-11', 'ພູຄູນ',       'Phoukhoune'),
  ('LP-12', 'ໂພນທອງ',    'Phonthong')
) AS d(code, lo, en)
WHERE p.province_code = 'LP'
ON CONFLICT (province_id, district_code) DO NOTHING;

-- Vientiane Province · 11 (Vang Vieng lives here, not in the capital)
INSERT INTO districts (province_id, district_code, district_name_lo, district_name_en)
SELECT p.province_id, d.code, d.lo, d.en
FROM provinces p, (VALUES
  ('VI-01', 'ໂພນໂຮງ',   'Phonhong'),
  ('VI-02', 'ທຸລະຄົມ',   'Thoulakhom'),
  ('VI-03', 'ແກ້ວອຸດົມ', 'Keooudom'),
  ('VI-04', 'ກາສີ',      'Kasi'),
  ('VI-05', 'ວັງວຽງ',    'Vangvieng'),
  ('VI-06', 'ເຟືອງ',     'Feuang'),
  ('VI-07', 'ຊະນະຄາມ', 'Xanakharm'),
  ('VI-08', 'ແມດ',      'Mad'),
  ('VI-09', 'ວຽງຄຳ',    'Viengkham'),
  ('VI-10', 'ຫີນເຫີບ',   'Hinheup'),
  ('VI-11', 'ໝື່ນ',      'Meun')
) AS d(code, lo, en)
WHERE p.province_code = 'VI'
ON CONFLICT (province_id, district_code) DO NOTHING;

-- Champasak · 10 (Pakse, and Khong for Si Phan Don)
INSERT INTO districts (province_id, district_code, district_name_lo, district_name_en)
SELECT p.province_id, d.code, d.lo, d.en
FROM provinces p, (VALUES
  ('CH-01', 'ປາກເຊ',              'Pakse'),
  ('CH-02', 'ຊະນະສົມບູນ',         'Sanasomboun'),
  ('CH-03', 'ບາຈຽງຈະເລີນສຸກ',    'Bachiangchaleunsook'),
  ('CH-04', 'ປາກຊ່ອງ',            'Paksong'),
  ('CH-05', 'ປະທຸມພອນ',          'Pathoumphone'),
  ('CH-06', 'ຜົ້ງທອງ',             'Phonthong'),
  ('CH-07', 'ຈຳປາສັກ',           'Champasak'),
  ('CH-08', 'ສຸຂຸມາ',              'Sukhuma'),
  ('CH-09', 'ມູນລະປະໂມກ',        'Moonlapamok'),
  ('CH-10', 'ໂຂງ',                'Khong')
) AS d(code, lo, en)
WHERE p.province_code = 'CH'
ON CONFLICT (province_id, district_code) DO NOTHING;

-- The provincial capital of each remaining province, so every province has at
-- least one usable district while the full list is being sourced.
INSERT INTO districts (province_id, district_code, district_name_lo, district_name_en)
SELECT p.province_id, d.code, d.lo, d.en
FROM provinces p, (VALUES
  ('PH', 'PH-01', 'ຜົ້ງສາລີ',            'Phongsaly'),
  ('LM', 'LM-01', 'ຫຼວງນ້ຳທາ',           'Luang Namtha'),
  ('OU', 'OU-01', 'ໄຊ',                  'Xay'),
  ('BK', 'BK-01', 'ຫ້ວຍຊາຍ',            'Houayxay'),
  ('HO', 'HO-01', 'ຊຳເໜືອ',             'Xamneua'),
  ('XA', 'XA-01', 'ໄຊຍະບູລີ',            'Xayaboury'),
  ('XI', 'XI-01', 'ແປກ',                 'Pek'),
  ('BL', 'BL-01', 'ປາກຊັນ',              'Pakxane'),
  ('KH', 'KH-01', 'ທ່າແຂກ',              'Thakhek'),
  ('SV', 'SV-01', 'ໄກສອນ ພົມວິຫານ',    'Kaysone Phomvihane'),
  ('SL', 'SL-01', 'ສາລະວັນ',             'Saravane'),
  ('XE', 'XE-01', 'ລະມາມ',              'Lamam'),
  ('AT', 'AT-01', 'ສາມັກຄີໄຊ',           'Samakkhixay'),
  ('XS', 'XS-01', 'ອະນຸວົງ',              'Anouvong')
) AS d(province, code, lo, en)
WHERE p.province_code = d.province
ON CONFLICT (province_id, district_code) DO NOTHING;

-- ── Amenities ───────────────────────────────────────────────────────────────
-- Icon names are lucide, matching the rest of the product.
INSERT INTO amenities (amenity_name_lo, amenity_name_en, icon, category) VALUES
  ('WiFi ຟຣີ',            'Free WiFi',            'wifi',            'general'),
  ('ບ່ອນຈອດລົດ',          'Parking',              'car',             'general'),
  ('ແອຄອນດິຊັນ',         'Air conditioning',     'snowflake',       'general'),
  ('ພັດລົມ',              'Fan',                  'fan',             'general'),
  ('ໂທລະທັດ',            'Television',           'tv',              'general'),
  ('ຕູ້ເຢັນ',              'Refrigerator',         'refrigerator',    'general'),
  ('ຕູ້ນິລະໄພ',            'Safe',                 'lock',            'general'),
  ('ລິບ',                 'Lift',                 'move-vertical',   'general'),
  ('ອາຫານເຊົ້າ',          'Breakfast',            'croissant',       'food'),
  ('ຮ້ານອາຫານ',          'Restaurant',           'utensils',        'food'),
  ('ບາ',                  'Bar',                  'wine',            'food'),
  ('ຄົວກິນເອງ',           'Kitchen',              'cooking-pot',     'kitchen'),
  ('ໄມໂຄຣເວັບ',          'Microwave',            'microwave',       'kitchen'),
  ('ນ້ຳຮ້ອນ',             'Hot water',            'shower-head',     'bathroom'),
  ('ອ່າງອາບນ້ຳ',          'Bathtub',              'bath',            'bathroom'),
  ('ເຄື່ອງໃຊ້ອາບນ້ຳ',      'Toiletries',           'droplets',        'bathroom'),
  ('ຜ້າເຊັດຕົວ',           'Towels',               'square',          'bathroom'),
  ('ສະລອຍນ້ຳ',           'Swimming pool',        'waves',           'facility'),
  ('ຫ້ອງອອກກຳລັງກາຍ',   'Gym',                  'dumbbell',        'facility'),
  ('ສະປາ',               'Spa',                  'flower',          'facility'),
  ('ສວນ',                'Garden',               'trees',           'facility'),
  ('ດາດຟ້າ',             'Rooftop terrace',      'sun',             'facility'),
  ('ຮັບຝາກເຄື່ອງ',        'Luggage storage',      'luggage',         'service'),
  ('ຮັບ 24 ຊົ່ວໂມງ',      '24-hour reception',    'clock',           'service'),
  ('ບໍລິການຊັກລີດ',        'Laundry',              'shirt',           'service'),
  ('ຮັບສົ່ງສະໜາມບິນ',    'Airport shuttle',      'plane',           'service'),
  ('ເຊົ່າລົດຖີບ',          'Bicycle rental',       'bike',            'service'),
  ('ຮັບສັດລ້ຽງ',          'Pet friendly',         'paw-print',       'policy'),
  ('ຫ້ອງປອດຄວັນ',       'Non-smoking rooms',    'cigarette-off',   'policy'),
  ('ເຂົ້າອອກດ້ວຍລໍ້',      'Wheelchair accessible','accessibility',   'accessibility')
ON CONFLICT DO NOTHING;

-- ── Cancellation policies ───────────────────────────────────────────────────
INSERT INTO cancellation_policies
  (policy_name, days_before_checkin, penalty_percent, is_refundable, description) VALUES
  ('ຢືດຢຸ່ນ · Flexible',      1, 0.00,   true,
   'ຍົກເລີກກ່ອນເຂົ້າພັກ 1 ວັນ ຄືນເງິນເຕັມ'),
  ('ປານກາງ · Moderate',     5, 30.00,  true,
   'ຍົກເລີກກ່ອນເຂົ້າພັກ 5 ວັນ ຄືນເງິນເຕັມ · ຫຼັງຈາກນັ້ນຫັກ 30%'),
  ('ເຂັ້ມງວດ · Strict',      14, 50.00,  true,
   'ຍົກເລີກກ່ອນເຂົ້າພັກ 14 ວັນ ຄືນເງິນເຕັມ · ຫຼັງຈາກນັ້ນຫັກ 50%'),
  ('ບໍ່ຄືນເງິນ · Non-refundable', 0, 100.00, false,
   'ຈ່າຍແລ້ວບໍ່ຄືນເງິນ ໃນທຸກກໍລະນີ')
ON CONFLICT DO NOTHING;

COMMIT;
