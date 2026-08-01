import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { AVAILABILITY_STATUS, BOOKING_STATUS, PARTNER_STATUS, percentOf } from '../../common/money';
import { addDaysUtc, isoDayUtc } from '../../common/dates';
import { assertStayDates, utcMidnight } from '../../common/booking-pricing';
import type { SearchDto } from './catalog.dto';

/** One bookable room for a requested stay, priced. */
interface BookableRoom {
  room_id: bigint;
  property_id: bigint;
  nights: number;
  /** Sum of the nightly prices across the whole stay, in kip. */
  stay_total: number;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Public property search.
   *
   * When dates are supplied the result only contains properties that can
   * actually take the booking — a listing that 404s at checkout is worse than
   * no listing. Availability is decided by the same two rules the booking
   * transaction enforces: no night may be `closed`, and live bookings on a
   * night must stay below the room's `qty`.
   */
  async search(dto: SearchDto) {
    const range = dto.checkIn && dto.checkOut
      ? assertStayDates(dto.checkIn, dto.checkOut)
      : null;

    const bookable = range
      ? await this.bookableRooms(range.checkIn, range.checkOut, dto.guests ?? 1)
      : await this.anyActiveRooms(dto.guests ?? 1);

    if (!bookable.size) return { items: [], total: 0, page: dto.page, limit: dto.limit, pages: 1 };

    const where: Prisma.propertiesWhereInput = {
      id: { in: [...bookable.byProperty.keys()].map((k) => BigInt(k)) },
      // Only approved partners are sellable, whatever the room calendar says.
      partners: { status: PARTNER_STATUS.VERIFIED },
    };
    if (dto.province) where.province = dto.province;
    if (dto.type) where.type = dto.type;
    if (dto.q) {
      const q = dto.q.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
        { province: { contains: q, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.properties.findMany({
      where,
      include: { _count: { select: { reviews: true } } },
    });

    const { service_fee_rate } = await this.settings.get();
    const nights = range?.nights ?? 1;

    let items = rows.map((p) => {
      const cheapest = bookable.byProperty.get(p.id.toString())!;
      const perNight = Math.round(cheapest.stay_total / cheapest.nights);
      return {
        id: p.id,
        name: p.name,
        type: p.type,
        province: p.province,
        address: p.address,
        lat: p.lat,
        lng: p.lng,
        rating: p.rating,
        reviewCount: p.review_count ?? 0,
        photos: p.photos ?? [],
        amenities: p.amenities,
        /** Cheapest bookable room, per night. */
        fromPricePerNight: perNight,
        /** What that room costs for the whole requested stay, before fees. */
        staySubtotal: range ? cheapest.stay_total : perNight,
        stayFee: range ? percentOf(cheapest.stay_total, service_fee_rate) : null,
        nights: range ? nights : null,
        availableRooms: cheapest.roomCount,
      };
    });

    if (dto.minPrice !== undefined) {
      items = items.filter((i) => i.fromPricePerNight >= dto.minPrice!);
    }
    if (dto.maxPrice !== undefined) {
      items = items.filter((i) => i.fromPricePerNight <= dto.maxPrice!);
    }

    items.sort(comparator(dto.sort));

    // The catalogue is small enough (tens of properties) that sorting by a
    // computed price in memory is cheaper than the SQL to do it. Move the
    // price/sort/paginate step into the raw query above if it ever isn't.
    const total = items.length;
    const start = (dto.page - 1) * dto.limit;

    return {
      items: items.slice(start, start + dto.limit),
      total,
      page: dto.page,
      limit: dto.limit,
      pages: Math.max(1, Math.ceil(total / dto.limit)),
    };
  }

  /** Everything a property page shows: rooms, reviews and the current price. */
  async findOne(id: bigint, checkIn?: string, checkOut?: string) {
    const property = await this.prisma.properties.findFirst({
      where: { id, partners: { status: PARTNER_STATUS.VERIFIED } },
      include: {
        rooms: { where: { is_active: true }, orderBy: { base_price: 'asc' } },
        partners: { select: { id: true, owner_name: true } },
        reviews: {
          where: { is_hidden: false },
          orderBy: { id: 'desc' },
          take: 20,
          include: { bookings: { select: { users: { select: { full_name: true } } } } },
        },
      },
    });

    if (!property) throw new NotFoundException(`ບໍ່ພົບທີ່ພັກ #${id} · Property not found`);

    const range = checkIn && checkOut ? assertStayDates(checkIn, checkOut) : null;
    const bookable = range
      ? await this.bookableRooms(range.checkIn, range.checkOut, 1, id)
      : null;
    const priced = range ? await this.pricedRooms(range.checkIn, range.checkOut, id) : null;

    return {
      id: property.id,
      name: property.name,
      type: property.type,
      province: property.province,
      address: property.address,
      lat: property.lat,
      lng: property.lng,
      rating: property.rating,
      reviewCount: property.review_count ?? 0,
      photos: property.photos ?? [],
      amenities: property.amenities,
      host: { id: property.partners.id, name: property.partners.owner_name },
      nights: range?.nights ?? null,
      rooms: property.rooms.map((r) => {
        const stay = priced?.get(r.id.toString());
        return {
          id: r.id,
          name: r.name,
          roomNo: r.room_no,
          hasAc: r.has_ac ?? true,
          bedType: r.bed_type,
          capacity: r.capacity,
          qty: r.qty,
          basePrice: r.base_price,
          photos: r.photos ?? [],
          /** Null when no dates were given — the base price applies. */
          stayTotal: stay ?? null,
          available: bookable ? bookable.roomIds.has(r.id.toString()) : null,
        };
      }),
      reviews: property.reviews.map((rv) => ({
        id: rv.id,
        stars: rv.stars,
        text: rv.text,
        guest: rv.bookings.users.full_name,
      })),
    };
  }

  /** Night-by-night price and status for a room, for the date-picker. */
  async roomCalendar(propertyId: bigint, from: string, to: string) {
    const start = utcMidnight(from);
    const end = utcMidnight(to);

    const rooms = await this.prisma.rooms.findMany({
      where: { property_id: propertyId, is_active: true },
      select: { id: true, name: true, base_price: true, qty: true },
    });
    if (!rooms.length) return { propertyId, rooms: [] };

    const roomIds = rooms.map((r) => r.id);

    const [calendar, bookings] = await Promise.all([
      this.prisma.room_availability.findMany({
        where: { room_id: { in: roomIds }, date: { gte: start, lt: end } },
      }),
      this.prisma.bookings.findMany({
        where: {
          room_id: { in: roomIds },
          status: { not: BOOKING_STATUS.CANCELLED },
          check_in: { lt: end },
          check_out: { gt: start },
        },
        select: { room_id: true, check_in: true, check_out: true },
      }),
    ]);

    const overrides = new Map(calendar.map((c) => [`${c.room_id}|${isoDayUtc(c.date)}`, c]));
    const used = new Map<string, number>();
    for (const b of bookings) {
      for (let d = new Date(b.check_in); d < b.check_out; d = addDaysUtc(d, 1)) {
        const key = `${b.room_id}|${isoDayUtc(d)}`;
        used.set(key, (used.get(key) ?? 0) + 1);
      }
    }

    return {
      propertyId,
      rooms: rooms.map((room) => {
        const days: { date: string; price: number; available: boolean }[] = [];
        for (let d = new Date(start); d < end; d = addDaysUtc(d, 1)) {
          const key = `${room.id}|${isoDayUtc(d)}`;
          const override = overrides.get(key);
          days.push({
            date: isoDayUtc(d),
            price: override?.price ?? room.base_price,
            available:
              override?.status !== AVAILABILITY_STATUS.CLOSED &&
              (used.get(key) ?? 0) < room.qty,
          });
        }
        return { id: room.id, name: room.name, qty: room.qty, days };
      }),
    };
  }

  async provinces() {
    const rows = await this.prisma.properties.groupBy({
      by: ['province'],
      where: { partners: { status: PARTNER_STATUS.VERIFIED } },
      _count: true,
      orderBy: { province: 'asc' },
    });
    return rows.map((r) => ({ province: r.province, count: r._count }));
  }

  // ── availability ──────────────────────────────────────────────────────────

  /**
   * Rooms that can take the whole stay, with what they cost.
   *
   * A room qualifies when no night is `closed` and every night still has a copy
   * free (`live bookings < qty`). `generate_series` expands the stay into one
   * row per night so both rules are checked per night, not per range — a room
   * booked solid on the middle night must not pass because its edges are free.
   */
  private async bookableRooms(
    checkIn: Date,
    checkOut: Date,
    guests: number,
    propertyId?: bigint,
  ) {
    const rows = await this.prisma.$queryRaw<BookableRoom[]>`
      WITH nights AS (
        SELECT generate_series(${checkIn}::date, ${checkOut}::date - 1, '1 day')::date AS d
      ),
      per_night AS (
        SELECT r.id                                   AS room_id,
               r.property_id                          AS property_id,
               r.qty                                  AS qty,
               n.d                                    AS d,
               COALESCE(ra.price, r.base_price)       AS price,
               COALESCE(ra.status, 'available')       AS status,
               (SELECT COUNT(*) FROM bookings b
                 WHERE b.room_id = r.id
                   AND b.status <> ${BOOKING_STATUS.CANCELLED}
                   AND b.check_in <= n.d AND b.check_out > n.d) AS used
        FROM rooms r
        CROSS JOIN nights n
        LEFT JOIN room_availability ra ON ra.room_id = r.id AND ra.date = n.d
        WHERE r.is_active
          AND r.capacity >= ${guests}
          ${propertyId ? Prisma.sql`AND r.property_id = ${propertyId}` : Prisma.empty}
      )
      SELECT room_id,
             property_id,
             COUNT(*)::int      AS nights,
             SUM(price)::int    AS stay_total
      FROM per_night
      GROUP BY room_id, property_id, qty
      HAVING BOOL_AND(status <> ${AVAILABILITY_STATUS.CLOSED})
         AND MAX(used) < qty
    `;

    return cheapestPerProperty(rows);
  }

  /** No dates given: every active room of a big-enough size counts. */
  private async anyActiveRooms(guests: number) {
    const rows = await this.prisma.rooms.findMany({
      where: { is_active: true, capacity: { gte: guests } },
      select: { id: true, property_id: true, base_price: true },
    });

    return cheapestPerProperty(
      rows.map((r) => ({
        room_id: r.id,
        property_id: r.property_id,
        nights: 1,
        stay_total: r.base_price,
      })),
    );
  }

  /** Stay total per room id, regardless of whether it is available. */
  private async pricedRooms(checkIn: Date, checkOut: Date, propertyId: bigint) {
    const rows = await this.prisma.$queryRaw<{ room_id: bigint; stay_total: number }[]>`
      WITH nights AS (
        SELECT generate_series(${checkIn}::date, ${checkOut}::date - 1, '1 day')::date AS d
      )
      SELECT r.id AS room_id, SUM(COALESCE(ra.price, r.base_price))::int AS stay_total
      FROM rooms r
      CROSS JOIN nights n
      LEFT JOIN room_availability ra ON ra.room_id = r.id AND ra.date = n.d
      WHERE r.property_id = ${propertyId} AND r.is_active
      GROUP BY r.id
    `;
    return new Map(rows.map((r) => [r.room_id.toString(), Number(r.stay_total)]));
  }
}

interface PropertyOffer {
  /** Cheapest qualifying room's total for the stay, in kip. */
  stay_total: number;
  nights: number;
  roomCount: number;
}

/**
 * Collapses per-room rows into one entry per property — the cheapest room, plus
 * how many rooms qualified (the "3 rooms left" line). `roomIds` keeps the
 * individual rooms so a property page can mark each one available or not.
 */
function cheapestPerProperty(rows: BookableRoom[]): {
  byProperty: Map<string, PropertyOffer>;
  roomIds: Set<string>;
  size: number;
} {
  const byProperty = new Map<string, PropertyOffer>();
  const roomIds = new Set<string>();

  for (const row of rows) {
    const key = row.property_id.toString();
    const total = Number(row.stay_total);
    const entry = byProperty.get(key);

    if (entry) {
      entry.stay_total = Math.min(entry.stay_total, total);
      entry.roomCount++;
    } else {
      byProperty.set(key, { stay_total: total, nights: Number(row.nights), roomCount: 1 });
    }
    roomIds.add(row.room_id.toString());
  }

  return { byProperty, roomIds, size: byProperty.size };
}

function comparator(sort: string | undefined) {
  type Item = { fromPricePerNight: number; rating: Prisma.Decimal | null; reviewCount: number };
  switch (sort) {
    case 'price_asc':
      return (a: Item, b: Item) => a.fromPricePerNight - b.fromPricePerNight;
    case 'price_desc':
      return (a: Item, b: Item) => b.fromPricePerNight - a.fromPricePerNight;
    case 'reviews':
      return (a: Item, b: Item) => b.reviewCount - a.reviewCount;
    case 'rating':
    default:
      // Rating first, then how many reviews back it up — a lone 5-star review
      // should not outrank a 4.8 with two hundred.
      return (a: Item, b: Item) =>
        Number(b.rating ?? 0) - Number(a.rating ?? 0) || b.reviewCount - a.reviewCount;
  }
}
