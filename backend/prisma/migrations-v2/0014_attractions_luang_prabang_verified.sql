-- User-verified Luang Prabang landmark coordinates (2026-09-16), superseding
-- the general-knowledge estimates 0013_attractions.sql seeded for the 3
-- overlapping entries, plus 17 additional verified Luang Prabang landmarks.
UPDATE attractions SET latitude = 19.74958, longitude = 101.99325 WHERE slug = 'kuang-si-falls';
UPDATE attractions SET latitude = 20.04907, longitude = 102.21097 WHERE slug = 'pak-ou-caves';
UPDATE attractions SET latitude = 19.89747, longitude = 102.14315 WHERE slug = 'wat-xieng-thong';

INSERT INTO attractions (name_lo, name_en, slug, latitude, longitude, province_id, source) VALUES
  ('ພູສີ', 'Mount Phousi', 'mount-phousi',
    19.89037, 102.13601, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ວັດວິຊຸນນະລາດ', 'Wat Visoun', 'wat-visoun',
    19.88699, 102.13827, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ວັດອາຮາມ', 'Wat Aham', 'wat-aham',
    19.88751, 102.13818, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ວັດຊຽງມ່ວນ', 'Wat Xieng Muan', 'wat-xieng-muan',
    19.8958, 102.1450, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ວັດສີສຸວັນນະພູມາຮາມ', 'Wat Mai Suwannaphumaham', 'wat-mai-suwannaphumaham',
    19.89060, 102.13501, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ວັດແສນສຸຂາຣາມ', 'Wat Sensoukharam', 'wat-sensoukharam',
    19.8960, 102.1420, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ວັດມະໂນຣົມ', 'Wat Manorom', 'wat-manorom',
    19.8849, 102.1326, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ວັດປ່າພອນເພົາ', 'Wat Pa Phon Phao', 'wat-pa-phon-phao',
    19.88861, 102.13500, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ພຣະລາດຊະວັງ / ຫໍພິພິທະພັນແຫ່ງຊາດ', 'Royal Palace & National Museum', 'royal-palace-national-museum',
    19.8935, 102.1360, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ນ້ຳຕົກຕາດແສ', 'Tad Sae Waterfalls', 'tad-sae-waterfalls',
    19.8225, 102.2417, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ບ້ານຊ່າງໄຫ', 'Ban Xang Hai / Whisky Village', 'ban-xang-hai-whisky-village',
    20.00343, 102.23227, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ບ້ານຈັນ', 'Ban Chan Pottery Village', 'ban-chan-pottery-village',
    19.85000, 102.16000, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ສູນຫັດຖະກຳ Ock Pop Tok', 'Ock Pop Tok Living Crafts Centre', 'ock-pop-tok-living-crafts-centre',
    19.89432, 102.14080, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ສູນສິລະປະແລະຊົນເຜົ່າ', 'Traditional Arts and Ethnology Centre', 'traditional-arts-and-ethnology-centre',
    19.89140, 102.13810, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ຟາມ Living Land', 'Living Land Farm', 'living-land-farm',
    19.88278, 102.13000, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ແມ່ນ້ຳຂອງ', 'Mekong River (Luang Prabang)', 'mekong-river-luang-prabang',
    19.88329, 102.13872, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ທາດຫຼວງ', 'Wat That Luang', 'wat-that-luang-lp',
    19.89333, 102.13694, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated')
ON CONFLICT (slug) DO NOTHING;
