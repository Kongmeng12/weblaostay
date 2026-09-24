-- LaoStay · schema v2 — manual ordering for the Home "Explore regions" rail
--
-- Every province defaults to `display_order = 0` on purpose: with nothing
-- set yet, CatalogService.provinces() breaks the tie alphabetically, so this
-- migration changes nothing visible until an admin actually reorders one
-- from webadmin's new "ຮູບແຂວງ" page.
--
-- Idempotent: IF NOT EXISTS guards the column add.

BEGIN;

ALTER TABLE provinces ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;

COMMIT;
