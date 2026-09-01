-- Tourist attractions/landmarks, resolved to coordinates so a guest can
-- search "Kuang Si Falls" and see stays near it (place-resolver.service.ts).
--
-- Two kinds of row: hand-curated ones seeded below (source='curated', never
-- overwritten), and ones written back automatically the first time a query
-- falls through to MapTiler geocoding (source='geocoded') — a self-growing
-- cache so the same place name never has to be geocoded twice.
--
-- *** The seeded coordinates below are drawn from general knowledge, not
-- *** independently surveyed. Verify each one against Google Maps/OpenStreetMap
-- *** before this migration is applied to a real database — a wrong landmark
-- *** coordinate silently produces wrong "nearby stays" results with nothing
-- *** in the code that could ever catch it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE attractions (
  attraction_id bigserial PRIMARY KEY,
  name_lo       varchar(160) NOT NULL,
  name_en       varchar(160),
  slug          varchar(160) NOT NULL UNIQUE,
  latitude      decimal(10,7) NOT NULL,
  longitude     decimal(11,7) NOT NULL,
  -- Same derivation as properties.geog (0001_schema_v2.sql) — kept in sync
  -- with latitude/longitude by construction, not by application code.
  geog geography(Point, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude::double precision,
                             latitude::double precision), 4326)::geography
  ) STORED,
  province_id   bigint REFERENCES provinces (province_id) ON DELETE SET NULL,
  source        varchar(20) NOT NULL DEFAULT 'curated' CHECK (source IN ('curated', 'geocoded')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_attractions_geog ON attractions USING GIST (geog);
CREATE INDEX idx_attractions_name_lo_trgm ON attractions USING GIN (name_lo gin_trgm_ops);
CREATE INDEX idx_attractions_name_en_trgm ON attractions USING GIN (name_en gin_trgm_ops);

INSERT INTO attractions (name_lo, name_en, slug, latitude, longitude, province_id, source) VALUES
  ('ນ້ຳຕົກຕາດກວາງຊີ', 'Kuang Si Falls', 'kuang-si-falls',
    19.7456, 102.1244, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ຖ້ຳປາກອູ', 'Pak Ou Caves', 'pak-ou-caves',
    20.0672, 102.2144, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ຕະຫຼາດຄ່ຳຫຼວງພະບາງ', 'Luang Prabang Night Market', 'luang-prabang-night-market',
    19.8856, 102.1347, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ວັດຊຽງທອງ', 'Wat Xieng Thong', 'wat-xieng-thong',
    19.8917, 102.1381, (SELECT province_id FROM provinces WHERE province_code = 'LP'), 'curated'),
  ('ພຣະທາດຫຼວງ', 'Pha That Luang', 'pha-that-luang',
    17.9757, 102.6331, (SELECT province_id FROM provinces WHERE province_code = 'VT'), 'curated'),
  ('ທົ່ງໄຫຫິນ', 'Plain of Jars', 'plain-of-jars',
    19.4325, 103.1533, (SELECT province_id FROM provinces WHERE province_code = 'XI'), 'curated'),
  ('ອ່າງເກັບນ້ຳງື່ມ', 'Nam Ngum Reservoir', 'nam-ngum-reservoir',
    18.5667, 102.6167, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ບຶງສີ ວັງວຽງ', 'Vang Vieng Blue Lagoon', 'vang-vieng-blue-lagoon',
    18.9333, 102.4333, (SELECT province_id FROM provinces WHERE province_code = 'VI'), 'curated'),
  ('ຖ້ຳກອງລໍ', 'Kong Lor Cave', 'kong-lor-cave',
    17.9333, 105.4667, (SELECT province_id FROM provinces WHERE province_code = 'KH'), 'curated'),
  ('ວັດພູ', 'Wat Phou', 'wat-phou',
    14.8500, 105.8167, (SELECT province_id FROM provinces WHERE province_code = 'CH'), 'curated'),
  ('ນ້ຳຕົກຕາດແຝນ', 'Tad Fane Waterfall', 'tad-fane-waterfall',
    15.1667, 106.2667, (SELECT province_id FROM provinces WHERE province_code = 'CH'), 'curated')
ON CONFLICT (slug) DO NOTHING;
