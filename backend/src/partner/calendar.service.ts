import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OwnershipService } from './ownership.service';
import { kipOf } from '../common/money';
import { parseDateRange, todayUtc, utcMidnight } from '../common/dates';

/** One booking-item × assigned-room row touching the requested day. */
interface StayRow {
  booking_id: bigint;
  booking_code: string;
  booking_status: string;
  check_in: Date;
  check_out: Date;
  nights: number;
  total_guests: number;
  guest_name: string | null;
  guest_phone: string | null;
  payment_status: string | null;
  room_type_id: bigint;
  booking_item_id: bigint;
  quantity: number;
  room_id: bigint | null;
  ra_check_in: Date | null;
  ra_check_out: Date | null;
}

interface DayBooking {
  bookingId: string;
  code: string;
  guestName: string;
  guestPhone: string | null;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  guests: number;
  status: string;
  paymentStatus: string | null;
}

function toDayBooking(r: StayRow): DayBooking {
  return {
    bookingId: r.booking_id.toString(),
    code: r.booking_code,
    guestName: r.guest_name ?? 'Guest',
    guestPhone: r.guest_phone,
    checkIn: r.check_in,
    checkOut: r.check_out,
    nights: r.nights,
    guests: r.total_guests,
    status: r.booking_status,
    paymentStatus: r.payment_status,
  };
}

/**
 * The partner Calendar: a month of per-day totals, and a single day broken
 * down room type by room type, room by room.
 *
 * A day D means the night of D (`check_in <= D < check_out`) plus whoever is
 * leaving that morning (`check_out = D`) — a turnover day therefore shows both
 * the departing and the arriving guest on the same room.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly own: OwnershipService,
  ) {}

  /** Per-day totals for the month grid: how full each day is, plus arrivals/departures. */
  async monthSummary(partnerId: bigint, propertyId: bigint, fromIso: string, toIso: string) {
    await this.own.assertOwnsProperty(partnerId, propertyId);
    const { from, to } = parseDateRange(fromIso, toIso, 62);

    const rows = await this.prisma.$queryRaw<
      {
        day: string;
        total: number;
        booked: number;
        held: number;
        on_sale: boolean;
        arrivals: number;
        departures: number;
      }[]
    >`
      WITH days AS (
        SELECT gs::date AS d FROM generate_series(${from}::date, ${to}::date - 1, '1 day') AS gs
      ),
      inv AS (
        SELECT ri.date AS d,
               SUM(ri.total_count)::int  AS total,
               SUM(ri.booked_count)::int AS booked,
               SUM(ri.held_count)::int   AS held,
               bool_or(ri.status = 'open') AS on_sale
        FROM room_inventory ri
        JOIN room_types rt ON rt.room_type_id = ri.room_type_id
        WHERE rt.property_id = ${propertyId} AND rt.deleted_at IS NULL
          AND ri.date >= ${from}::date AND ri.date < ${to}::date
        GROUP BY ri.date
      ),
      arr AS (
        SELECT b.check_in AS d, COUNT(*)::int AS c FROM bookings b
        WHERE b.property_id = ${propertyId} AND b.deleted_at IS NULL
          AND b.status NOT IN ('cancelled', 'no_show')
          AND b.check_in >= ${from}::date AND b.check_in < ${to}::date
        GROUP BY b.check_in
      ),
      dep AS (
        SELECT b.check_out AS d, COUNT(*)::int AS c FROM bookings b
        WHERE b.property_id = ${propertyId} AND b.deleted_at IS NULL
          AND b.status NOT IN ('cancelled', 'no_show')
          AND b.check_out >= ${from}::date AND b.check_out < ${to}::date
        GROUP BY b.check_out
      )
      SELECT to_char(days.d, 'YYYY-MM-DD') AS day,
             COALESCE(inv.total, 0)  AS total,
             COALESCE(inv.booked, 0) AS booked,
             COALESCE(inv.held, 0)   AS held,
             COALESCE(inv.on_sale, false) AS on_sale,
             COALESCE(arr.c, 0) AS arrivals,
             COALESCE(dep.c, 0) AS departures
      FROM days
      LEFT JOIN inv ON inv.d = days.d
      LEFT JOIN arr ON arr.d = days.d
      LEFT JOIN dep ON dep.d = days.d
      ORDER BY days.d
    `;

    return {
      days: rows.map((r) => ({
        date: r.day,
        total: r.total,
        booked: r.booked,
        held: r.held,
        onSale: r.on_sale,
        arrivals: r.arrivals,
        departures: r.departures,
      })),
    };
  }

  /** Every room type and room in the property for one day — the Day detail screen. */
  async dayBoard(partnerId: bigint, propertyId: bigint, dateIso: string) {
    await this.own.assertOwnsProperty(partnerId, propertyId);
    const date = utcMidnight(dateIso);
    // `needs_cleaning` describes the room's physical state right now; on a
    // future date it would be a false claim, so it only surfaces up to today.
    const showHousekeeping = date.getTime() <= todayUtc().getTime();

    const roomTypes = await this.prisma.room_types.findMany({
      where: { property_id: propertyId, deleted_at: null },
      select: { room_type_id: true, type_name: true, total_rooms: true, base_price: true },
      orderBy: { room_type_id: 'asc' },
    });
    if (!roomTypes.length) {
      return {
        date: dateIso,
        summary: { total: 0, taken: 0, arrivals: 0, departures: 0, needsCleaning: 0, unassigned: 0 },
        roomTypes: [],
      };
    }
    const typeIds = roomTypes.map((rt) => rt.room_type_id);

    const [rooms, inventory, prices, stays] = await Promise.all([
      this.prisma.rooms.findMany({
        where: { room_type_id: { in: typeIds } },
        select: { room_id: true, room_number: true, floor: true, status: true, room_type_id: true },
        orderBy: [{ room_type_id: 'asc' }, { room_number: 'asc' }],
      }),
      this.prisma.room_inventory.findMany({
        where: { room_type_id: { in: typeIds }, date },
        select: { room_type_id: true, total_count: true, held_count: true, booked_count: true, status: true },
      }),
      this.prisma.room_prices.findMany({
        where: { room_type_id: { in: typeIds }, date },
        select: { room_type_id: true, price: true },
      }),
      this.prisma.$queryRaw<StayRow[]>`
        SELECT b.booking_id, b.booking_code, b.status::text AS booking_status,
               b.check_in, b.check_out, b.nights, b.total_guests,
               COALESCE(bg.full_name, up.full_name) AS guest_name,
               u.phone AS guest_phone,
               (SELECT p.status::text FROM payments p
                 WHERE p.booking_id = b.booking_id ORDER BY p.created_at DESC LIMIT 1) AS payment_status,
               bi.room_type_id, bi.booking_item_id, bi.quantity,
               ra.room_id, ra.check_in AS ra_check_in, ra.check_out AS ra_check_out
        FROM bookings b
        JOIN booking_items bi ON bi.booking_id = b.booking_id
        JOIN users u ON u.user_id = b.customer_id
        LEFT JOIN user_profiles up ON up.user_id = u.user_id
        LEFT JOIN booking_guests bg ON bg.booking_id = b.booking_id AND bg.is_primary = true
        LEFT JOIN room_assignments ra ON ra.booking_item_id = bi.booking_item_id
        WHERE b.property_id = ${propertyId} AND b.deleted_at IS NULL
          AND b.status NOT IN ('cancelled', 'no_show')
          AND b.check_in <= ${date}::date AND b.check_out >= ${date}::date
        ORDER BY b.check_in, b.booking_id
      `,
    ]);

    const invByType = new Map(inventory.map((i) => [i.room_type_id.toString(), i]));
    const priceByType = new Map(prices.map((p) => [p.room_type_id.toString(), p.price]));
    const roomsByType = new Map<string, typeof rooms>();
    for (const room of rooms) {
      const key = room.room_type_id.toString();
      (roomsByType.get(key) ?? roomsByType.set(key, []).get(key)!).push(room);
    }

    const D = date.getTime();
    const coversNight = (ci: Date, co: Date) => ci.getTime() <= D && D < co.getTime();

    // Assigned-room count per booking item, to spot bookings with no room number.
    const assignedByItem = new Map<string, Set<string>>();
    for (const s of stays) {
      if (s.room_id === null) continue;
      const key = s.booking_item_id.toString();
      (assignedByItem.get(key) ?? assignedByItem.set(key, new Set()).get(key)!).add(s.room_id.toString());
    }

    let needsCleaning = 0;
    let unassignedTotal = 0;

    const sections = roomTypes.map((rt) => {
      const key = rt.room_type_id.toString();
      const inv = invByType.get(key);
      const typeRooms = roomsByType.get(key) ?? [];
      const hasRoomNumbers = typeRooms.length > 0;
      const typeStays = stays.filter((s) => s.room_type_id === rt.room_type_id);

      // One row per booking item — a booking of 2 rooms has 2 assignment rows.
      const seenItems = new Set<string>();
      const uniqueItems = typeStays.filter((s) => {
        const k = s.booking_item_id.toString();
        if (seenItems.has(k)) return false;
        seenItems.add(k);
        return true;
      });

      const base = {
        roomTypeId: key,
        roomTypeName: rt.type_name,
        hasRoomNumbers,
        price: kipOf(priceByType.get(key) ?? rt.base_price),
        onSale: inv?.status === 'open',
        total: inv?.total_count ?? 0,
        booked: inv?.booked_count ?? 0,
        held: inv?.held_count ?? 0,
      };

      if (!hasRoomNumbers) {
        return { ...base, rooms: [], unassigned: [], bookings: uniqueItems.map(toDayBooking) };
      }

      const roomViews = typeRooms.map((room) => {
        const roomId = room.room_id.toString();
        const mine = typeStays.filter((s) => s.room_id !== null && s.room_id.toString() === roomId);
        const occupantRow = mine.find(
          (s) => s.ra_check_in && s.ra_check_out && coversNight(s.ra_check_in, s.ra_check_out),
        );
        const departureRow = mine.find((s) => s.ra_check_out && s.ra_check_out.getTime() === D);

        let status: string = room.status;
        if (status === 'needs_cleaning' && !showHousekeeping) status = 'available';
        if (status === 'needs_cleaning') needsCleaning++;

        return {
          roomId,
          roomNumber: room.room_number,
          floor: room.floor,
          status,
          occupant: occupantRow ? toDayBooking(occupantRow) : null,
          departure: departureRow ? toDayBooking(departureRow) : null,
        };
      });

      // Booked for this type that night but not yet given a room number.
      const unassigned = uniqueItems
        .filter((s) => coversNight(s.check_in, s.check_out))
        .map((s) => ({
          ...toDayBooking(s),
          missingRooms: s.quantity - (assignedByItem.get(s.booking_item_id.toString())?.size ?? 0),
        }))
        .filter((s) => s.missingRooms > 0);
      unassignedTotal += unassigned.length;

      return { ...base, rooms: roomViews, unassigned, bookings: [] };
    });

    const distinct = (pick: (s: StayRow) => boolean) =>
      new Set(stays.filter(pick).map((s) => s.booking_id.toString())).size;

    return {
      date: dateIso,
      summary: {
        total: inventory.reduce((n, i) => n + i.total_count, 0),
        taken: inventory.reduce((n, i) => n + i.booked_count + i.held_count, 0),
        arrivals: distinct((s) => s.check_in.getTime() === D),
        departures: distinct((s) => s.check_out.getTime() === D),
        needsCleaning,
        unassigned: unassignedTotal,
      },
      roomTypes: sections,
    };
  }
}
