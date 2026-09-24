-- LaoStay · schema v2 — admin-curated province photo
--
-- Backs the "Explore regions" rail on Home: an admin can now set a specific
-- photo for a province via webadmin. When unset, CatalogService.provinces()
-- falls back to the cover photo of that province's best-rated property, so
-- every province still shows something real rather than a blank slot the
-- moment it has at least one listed property.
--
-- Idempotent: IF NOT EXISTS guards the column add.

BEGIN;

ALTER TABLE provinces ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);

COMMIT;
