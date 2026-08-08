-- LaoStay · schema v2 — triggers
--
-- Two jobs only, both chosen because doing them in application code means they
-- eventually stop being done:
--
--   1. `updated_at` — a column nobody remembers to set by hand
--   2. `properties.rating_avg` / `review_count` — a cached aggregate that is
--      worthless the moment it disagrees with the reviews it summarises
--
-- Everything else (inventory holds, the ledger, payouts) stays in application
-- transactions where it can be read, tested and reasoned about.

BEGIN;

-- ── updated_at ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attached to every table that has the column, rather than listing them by
-- hand: a table added later gets it by re-running this block.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      't_' || t.table_name || '_updated_at', t.table_name);
  END LOOP;
END $$;

-- ── property rating ─────────────────────────────────────────────────────────

-- Recomputed from the rows themselves rather than adjusted incrementally: an
-- incremental counter drifts the first time a write is rolled back, and this
-- runs on a handful of rows per property.
CREATE OR REPLACE FUNCTION recalc_property_rating() RETURNS trigger AS $$
DECLARE
  target_property bigint := COALESCE(NEW.property_id, OLD.property_id);
BEGIN
  UPDATE properties p
  SET rating_avg = COALESCE(agg.avg_rating, 0),
      review_count = COALESCE(agg.n, 0)
  FROM (
    SELECT round(avg(overall_rating)::numeric, 2) AS avg_rating,
           count(*)                               AS n
    FROM reviews
    WHERE property_id = target_property
      AND status = 'published'
  ) agg
  WHERE p.property_id = target_property;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- AFTER, and on every path that can change the visible set — a review being
-- hidden by a moderator must move the score just as much as a new one does.
CREATE TRIGGER t_reviews_recalc_rating
  AFTER INSERT OR UPDATE OF overall_rating, status, property_id OR DELETE
  ON reviews
  FOR EACH ROW EXECUTE FUNCTION recalc_property_rating();

-- ── conversation preview ────────────────────────────────────────────────────

-- Keeps the chat list orderable without a correlated subquery per row.
CREATE OR REPLACE FUNCTION touch_conversation() RETURNS trigger AS $$
BEGIN
  UPDATE conversations
  SET last_message_id = NEW.message_id,
      last_message_at = NEW.created_at
  WHERE conversation_id = NEW.conversation_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_messages_touch_conversation
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION touch_conversation();

COMMIT;
