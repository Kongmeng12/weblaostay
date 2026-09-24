-- LaoStay · schema v2 — `hotel` property type, and who picked the room
--
-- 1. `property_type` had homestay | villa | resort | guesthouse. Hotels were
--    signing up as guesthouses.
--
-- 2. `bookings.guest_chose_room`: true when the guest picked their numbered
--    room at booking time, false when they left it to the property. The
--    partner dashboard splits today's arrivals on it and lists the bookings
--    still waiting for the front desk to choose. It cannot be worked out from
--    `room_assignments` alone: a room the partner assigns later looks just
--    like one the guest picked.
--
-- Postgres allows ADD VALUE inside a transaction as long as the new value is
-- not used in that same transaction, which this does not.

BEGIN;

ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'hotel';

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS guest_chose_room BOOLEAN NOT NULL DEFAULT false;

-- Backfill. A guest's pick is written in the same transaction as the booking,
-- so its assignment is created within moments of the booking itself. A
-- partner's assignment comes later, and a walk-in's room is always the
-- front desk's choice.
UPDATE bookings b
SET guest_chose_room = true
WHERE b.source <> 'walk_in'
  AND EXISTS (
    SELECT 1
    FROM booking_items bi
    JOIN room_assignments ra ON ra.booking_item_id = bi.booking_item_id
    WHERE bi.booking_id = b.booking_id
      AND ra.created_at <= b.created_at + INTERVAL '1 minute'
  );

COMMIT;
