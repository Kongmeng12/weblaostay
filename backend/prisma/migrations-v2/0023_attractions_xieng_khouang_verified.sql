-- User-verified Xieng Khouang landmark coordinates (2026-10-04), Xiangkhouang
-- Province ('XI'). Moves 0013_attractions.sql's general-knowledge
-- 'plain-of-jars' estimate onto the verified Site 1 spot — the one a bare
-- "Plain of Jars"/"ທົ່ງໄຫຫິນ" query lands on — plus 12 verified landmarks.
UPDATE attractions SET latitude = 19.43083, longitude = 103.15367 WHERE slug = 'plain-of-jars';

-- 0014 was edited after it had already run to rename this row; its
-- ON CONFLICT DO NOTHING means a re-run never reaches an existing row, so
-- the rename has to land here to reach the live database.
UPDATE attractions SET name_lo = 'ວັດທາດຫຼວງ ຫຼວງພະບາງ' WHERE slug = 'wat-that-luang-lp';

INSERT INTO attractions (name_lo, name_en, slug, latitude, longitude, province_id, source) VALUES
  ('ທົ່ງໄຫຫີນ 1', 'Plain of Jars Site 1', 'plain-of-jars-site-1',
    19.43083, 103.15367, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  ('ທົ່ງໄຫຫີນ 2', 'Plain of Jars Site 2', 'plain-of-jars-site-2',
    19.31786, 103.15442, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  ('ທົ່ງໄຫຫີນ 3', 'Plain of Jars Site 3', 'plain-of-jars-site-3',
    19.29369, 103.14919, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  ('ພູແກ້ງ', 'Phu Keng', 'phu-keng',
    19.48486, 103.08394, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  ('ວັດເພຍວັດ', 'Wat Phia Wat', 'wat-phia-wat',
    19.32806, 103.37000, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  ('ທາດຝຸ່ນ', 'That Foun', 'that-foun',
    19.33447, 103.36730, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  ('ນ້ຳຕົກຕາດຫຼວງ', 'Tad Lang Waterfall', 'tad-lang-waterfall',
    19.30406, 103.17858, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  ('ອານຸສາວະລີສົງຄາມລາວ', 'Laos War Memorial', 'laos-war-memorial',
    19.43780, 103.20819, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  ('ອານຸສາວະລີສົງຄາມລາວ-ຫວຽດນາມ', 'Vietnamese War Monument', 'vietnamese-war-monument',
    19.43814, 103.20154, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  ('ວັດຍອນ', 'Wat Yon', 'wat-yon',
    19.44068, 103.20530, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  ('ພິພິດທະພັນແຂວງຊຽງຂວາງ', 'Xieng Khouang Provincial Museum', 'xieng-khouang-provincial-museum',
    19.44471, 103.21039, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  ('ສູນຂໍ້ມູນ MAG', 'MAG Visitor Centre', 'mag-visitor-centre',
    19.45025, 103.22022, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),

  -- Aliases: the standard spellings ທົ່ງໄຫຫິນ (short ິ) and ພິພິທະພັນ. A
  -- query in those spellings either misses the rows above or, for
  -- "ທົ່ງໄຫຫິນ 2", ranks the bare 'plain-of-jars' row (Site 1) higher —
  -- these make each site reachable by the spelling people actually type.
  ('ທົ່ງໄຫຫິນ 1', 'Plain of Jars Site 1', 'thong-hai-hin-1',
    19.43083, 103.15367, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  ('ທົ່ງໄຫຫິນ 2', 'Plain of Jars Site 2', 'thong-hai-hin-2',
    19.31786, 103.15442, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  ('ທົ່ງໄຫຫິນ 3', 'Plain of Jars Site 3', 'thong-hai-hin-3',
    19.29369, 103.14919, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  ('ຫໍພິພິທະພັນແຂວງຊຽງຂວາງ', 'Xieng Khouang Provincial Museum', 'xieng-khouang-museum',
    19.44471, 103.21039, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  -- Without this, "ຕາດຫຼວງ" ranks Luang Prabang's 'ທາດຫຼວງ' (one letter off,
  -- far shorter) above 'ນ້ຳຕົກຕາດຫຼວງ' and searches ~120 km away.
  ('ຕາດຫຼວງ', 'Tad Lang Waterfall', 'tad-luang-xieng-khouang',
    19.30406, 103.17858, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated')
ON CONFLICT (slug) DO NOTHING;
