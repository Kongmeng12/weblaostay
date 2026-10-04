-- User-verified Vang Vieng landmark coordinates (2026-10-04), Vientiane
-- Province ('VI'). Moves 0013_attractions.sql's general-knowledge
-- 'vang-vieng-blue-lagoon' estimate onto the verified Blue Lagoon 1 spot, so
-- a "ບຶງສີ"/"Blue Lagoon" query that lands on that older row no longer
-- searches around the wrong point, plus 15 verified Vang Vieng landmarks.
UPDATE attractions SET latitude = 18.92670, longitude = 102.39563 WHERE slug = 'vang-vieng-blue-lagoon';

INSERT INTO attractions (name_lo, name_en, slug, latitude, longitude, province_id, source) VALUES
  ('ບລູລາກູນ 1', 'Blue Lagoon 1', 'blue-lagoon-1',
    18.92670, 102.39563, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ຖ້ຳປູຄຳ', 'Tham Phu Kham Cave', 'tham-phu-kham-cave',
    18.92747, 102.39647, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ຈຸດຊົມວິວຜາໜາມໄຊ', 'Nam Xay Viewpoint', 'nam-xay-viewpoint',
    18.92260, 102.38895, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ຈຸດຊົມວິວຜາເງິນ', 'Pha Ngern Viewpoint', 'pha-ngern-viewpoint',
    18.91612, 102.41304, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ຖ້ຳຈັງ', 'Tham Chang Cave', 'tham-chang-cave',
    18.90899, 102.44200, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ນ້ຳຕົກແກ້ງນີ້', 'Kaeng Nyui Waterfall', 'kaeng-nyui-waterfall',
    18.95626, 102.49683, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ບລູລາກູນ 2', 'Blue Lagoon 2', 'blue-lagoon-2',
    18.88939, 102.37747, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ບລູລາກູນ 3', 'Blue Lagoon 3', 'blue-lagoon-3',
    18.94141, 102.33619, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ຖ້ຳນອນ', 'Tham None Cave', 'tham-none-cave',
    18.94706, 102.43415, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ຖ້ຳລົມ', 'Lom Cave', 'lom-cave',
    18.95773, 102.43673, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ຖ້ຳນ້ຳ', 'Tham Nam Water Cave', 'tham-nam-water-cave',
    19.03519, 102.42522, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ຖ້ຳຊ້າງ', 'Tham Xang Elephant Cave', 'tham-xang-elephant-cave',
    19.03901, 102.43074, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ບລູລາກູນ 4', 'Blue Lagoon 4', 'blue-lagoon-4',
    19.04541, 102.42443, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ວັດກາງ', 'Wat Kang', 'wat-kang',
    18.92652, 102.44906, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ວັດທາດ', 'Wat That', 'wat-that',
    18.92938, 102.44928, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),

  -- Aliases: the same spots under the names people actually type. One
  -- name_lo per row, and a short query like "ແກ້ງຍຸ້ຍ" or "ບຶງສີ 2" scores
  -- under PlaceResolverService's 0.3 similarity cutoff against the names
  -- above, so these exist purely so those spellings still resolve.
  ('ບຶງສີ 1', 'Blue Lagoon 1', 'bueng-si-1',
    18.92670, 102.39563, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ບຶງສີ 2', 'Blue Lagoon 2', 'bueng-si-2',
    18.88939, 102.37747, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ບຶງສີ 3', 'Blue Lagoon 3', 'bueng-si-3',
    18.94141, 102.33619, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ບຶງສີ 4', 'Blue Lagoon 4', 'bueng-si-4',
    19.04541, 102.42443, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ຕາດແກ້ງຍຸ້ຍ', 'Kaeng Nyui Waterfall', 'tad-kaeng-nyui',
    18.95626, 102.49683, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ຈຸດຊົມວິວຜານາມໄຊ', 'Nam Xay Viewpoint', 'pha-nam-xay-viewpoint',
    18.92260, 102.38895, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated')
ON CONFLICT (slug) DO NOTHING;
