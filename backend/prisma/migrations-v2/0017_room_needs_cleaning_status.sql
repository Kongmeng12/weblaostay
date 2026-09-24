-- LaoStay · schema v2 — housekeeping status for individually-numbered rooms
--
-- `rooms.status` was available | maintenance | inactive — no way to flag a
-- room that a guest just checked out of but housekeeping hasn't turned over
-- yet. `HousekeepingSweeperService` sets this automatically once a booking's
-- `room_assignments.check_out` has passed; the partner clears it by hand
-- (`PATCH /partner/rooms/:id/clean`) once it's actually clean.
--
-- Postgres allows ADD VALUE inside its own transaction as long as the new
-- value isn't used in that same transaction, which this doesn't.

BEGIN;

ALTER TYPE room_status ADD VALUE IF NOT EXISTS 'needs_cleaning';

COMMIT;
