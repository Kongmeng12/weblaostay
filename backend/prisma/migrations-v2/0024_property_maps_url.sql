-- The partner sign-up form lets the applicant either drop a pin or paste a
-- Google Maps link. A short link (maps.app.goo.gl/…) carries no coordinates
-- the server can read, so the link itself is kept for the admin reviewing the
-- application to open and pin from.
--
-- Nullable and additive only, so a server still running the previous build
-- keeps working.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS maps_url varchar(500);
