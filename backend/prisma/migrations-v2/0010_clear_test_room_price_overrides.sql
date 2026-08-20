-- LaoStay · schema v2 — clear stale per-date overrides on the ₭1 test room
--
-- `room_prices` holds per-date price overrides that `priceStay()`
-- (inventory.service.ts) prefers over `room_types.base_price` via
-- `COALESCE(rp.price, rt.base_price)` — that's the intended mechanism for a
-- partner's weekend/holiday markup, working correctly. But "ຫ້ອງທົດສອບຈ່າຍເງິນ ·
-- Payment Test Room (1 KIP)" picked up three leftover override rows
-- (₭777,000 × Oct 15-17 2026) from earlier testing of that same feature —
-- so a guest booking that specific room across those dates got quoted
-- ₭2,331,000+ instead of the ₭1/night the room exists to test. A payment
-- test room has no legitimate reason to carry per-date pricing at all, so
-- this clears every override on it, not just the three visible in the bug
-- report — any others would cause the identical confusion on other dates.
--
-- Idempotent: deleting rows that no longer exist is a no-op.

BEGIN;

DELETE FROM room_prices
WHERE room_type_id IN (
  SELECT room_type_id FROM room_types WHERE type_name ILIKE '%payment test room%'
);

COMMIT;
