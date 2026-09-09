-- Physical rooms and per-room booking assignment.
--
-- Booking has always priced and held inventory at the `room_types` level —
-- "2 Deluxe rooms," never "room 204 and room 206." That is still how every
-- existing room type works, and stays the default: `room_types` gains one
-- new column, `allow_room_selection`, defaulted `false`, so nothing already
-- on sale changes behaviour. When a partner opts a room type in, a guest
-- booking it can additionally name which physical room(s) they want.
--
-- `rooms` is the room type's numbered inventory (204, 206, ...) — new, and
-- deliberately just identity + status, not a second pricing/availability
-- system. `room_types`/`room_inventory`/`room_prices` still decide *how many*
-- rooms are for sale on a given night and at what price; `rooms` only ever
-- answers *which physical one*.
--
-- `room_assignments` is where a booking item claims specific rooms. Its own
-- correctness does not rely on application logic getting the check right —
-- `room_assignments_no_overlap` below is a database EXCLUDE constraint, the
-- same division of labour as `room_inventory_no_overbook`: the application
-- validates first so a guest gets a readable message, but the constraint is
-- what actually makes double-booking the same physical room impossible, even
-- from a bug or a second server the application code never anticipated.

BEGIN;

-- `=` on bigint has no GiST operator class by default; EXCLUDE below needs
-- one to combine `room_id` equality with `daterange` overlap in a single
-- index-backed constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE room_status AS ENUM ('available', 'maintenance', 'inactive');

ALTER TABLE room_types
  ADD COLUMN allow_room_selection boolean NOT NULL DEFAULT false;

CREATE TABLE rooms (
  room_id      bigserial    PRIMARY KEY,
  room_type_id bigint       NOT NULL REFERENCES room_types (room_type_id) ON DELETE CASCADE,
  room_number  varchar(50)  NOT NULL,
  floor        varchar(20),
  status       room_status  NOT NULL DEFAULT 'available',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (room_type_id, room_number)
);

CREATE INDEX idx_rooms_room_type ON rooms (room_type_id);

CREATE TRIGGER t_rooms_updated_at BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE room_assignments (
  room_assignment_id bigserial   PRIMARY KEY,
  -- RESTRICT, matching booking_items.room_type_id: a room that has ever been
  -- assigned to a stay carries booking history and is deactivated, not deleted.
  room_id             bigint      NOT NULL REFERENCES rooms         (room_id)         ON DELETE RESTRICT,
  booking_item_id     bigint      NOT NULL REFERENCES booking_items (booking_item_id) ON DELETE CASCADE,
  check_in            date        NOT NULL,
  check_out           date        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_assignments_checkout_after_checkin CHECK (check_out > check_in),
  -- The actual overbooking guard for a specific room number: two rows for the
  -- same room with overlapping [check_in, check_out) ranges are rejected by
  -- Postgres itself, regardless of what the application already checked.
  CONSTRAINT room_assignments_no_overlap EXCLUDE USING gist (
    room_id WITH =,
    daterange(check_in, check_out, '[)') WITH &&
  )
);

CREATE INDEX idx_room_assignments_booking_item ON room_assignments (booking_item_id);

-- Backfill so a partner can flip `allow_room_selection` on immediately
-- without first re-entering every room number by hand. Plain sequential
-- numbers — partners can rename them (204, 206, ...) after the fact.
INSERT INTO rooms (room_type_id, room_number)
SELECT rt.room_type_id, gs::text
FROM room_types rt
CROSS JOIN LATERAL generate_series(1, rt.total_rooms) AS gs
ON CONFLICT (room_type_id, room_number) DO NOTHING;

COMMIT;
