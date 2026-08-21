import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { kipOf, rateOf } from '../common/money';
import { addDaysUtc, isoDayUtc, utcMidnight } from '../common/dates';
import type { CalendarQueryDto, SearchDto } from './catalog.dto';

/**
 * One row of the search result, straight out of the raw query below.
 * Money arrives as a Postgres bigint, which the pg driver hands back as a
 * string when it exceeds the safe range — `kipOf` normalises either form.
 */
interface SearchRow {
  property_id: bigint;
  property_name: string;
  property_type: string;
  province_name_lo: string | null;
  district_name_lo: string | null;
  address_detail: string | null;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
  rating_avg: Prisma.Decimal;
  review_count: number;
  cover_image: string | null;
  from_price: bigint | null;
  stay_total: bigint | null;
  available_rooms: number;
  distance_m: number | null;
  total_count: bigint;
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public property search.
   *
   * Written as one raw query rather than assembled in TypeScript for three
   * reasons: `geog` and `search_vector` are Prisma `Unsupported` types and
   * cannot be expressed at all; the availability test needs *every* night of
   * the stay to have room, which is a `HAVING count(...) = nights` and not a
   * filter; and paging has to happen after the price is known, so the price
   * must be computed in the database.
   *
   * When dates are supplied the result only contains properties that can
   * actually take the booking — a listing that 409s at checkout is worse than
   * no listing at all.
   */
  async search(dto: SearchDto) {
    const range = this.parseRange(dto.checkIn, dto.checkOut);
    const guests = dto.guests ?? 1;
    const offset = (dto.page - 1) * dto.limit;

    // `nights` drives both the price sum and the availability count.
    const nights = range ? range.nights : 1;
    const from = range?.checkIn ?? null;
    const toExclusive = range?.checkOut ?? null;

    const hasGeo = dto.lat !== undefined && dto.lng !== undefined;
    const radiusMeters = (dto.radiusKm ?? 50) * 1000;

    const rows = await this.prisma.$queryRaw<SearchRow[]>`
      WITH nights AS (
        SELECT gs::date AS d
        FROM generate_series(
               COALESCE(${from}::date, CURRENT_DATE),
               COALESCE(${toExclusive}::date, CURRENT_DATE + 1) - 1,
               '1 day') AS gs
      ),
      -- A room type qualifies only if it has space on EVERY night, which is
      -- what the count comparison enforces. stay_total is the sum of that
      -- room's nightly prices, falling back to the base price for nights the
      -- partner never priced explicitly.
      bookable AS (
        SELECT rt.property_id,
               rt.room_type_id,
               SUM(COALESCE(rp.price, rt.base_price))::bigint AS stay_total,
               MIN(COALESCE(rp.price, rt.base_price))::bigint AS min_night
        FROM room_types rt
        CROSS JOIN nights n
        LEFT JOIN room_prices rp
               ON rp.room_type_id = rt.room_type_id AND rp.date = n.d
        LEFT JOIN room_inventory ri
               ON ri.room_type_id = rt.room_type_id AND ri.date = n.d
        WHERE rt.status = 'active'
          AND rt.deleted_at IS NULL
          AND rt.max_occupancy >= ${guests}
          AND (
            -- With no dates asked for, inventory is not consulted at all.
            ${from}::date IS NULL
            OR (ri.status = 'open' AND ri.available_count >= 1)
          )
        GROUP BY rt.property_id, rt.room_type_id
        HAVING ${from}::date IS NULL
            OR COUNT(*) = (SELECT COUNT(*) FROM nights)
      ),
      offers AS (
        SELECT property_id,
               MIN(stay_total)          AS stay_total,
               MIN(min_night)           AS from_price,
               COUNT(*)::int            AS available_rooms
        FROM bookable
        GROUP BY property_id
      )
      SELECT p.property_id,
             p.property_name,
             p.property_type::text,
             pv.province_name_lo,
             d.district_name_lo,
             p.address_detail,
             p.latitude,
             p.longitude,
             p.rating_avg,
             p.review_count,
             (SELECT COALESCE(pi.thumbnail_url, pi.image_url) FROM property_images pi
               WHERE pi.property_id = p.property_id
               ORDER BY pi.is_cover DESC, pi.display_order ASC
               LIMIT 1)                                    AS cover_image,
             o.from_price,
             o.stay_total,
             o.available_rooms,
             CASE WHEN ${hasGeo}
                  THEN ST_Distance(p.geog,
                         ST_SetSRID(ST_MakePoint(${dto.lng ?? 0}, ${dto.lat ?? 0}), 4326)::geography)
                  ELSE NULL END                            AS distance_m,
             COUNT(*) OVER ()::bigint                      AS total_count
      FROM properties p
      JOIN offers   o  ON o.property_id = p.property_id
      JOIN partners pa ON pa.partner_id = p.partner_id
      LEFT JOIN provinces pv ON pv.province_id = p.province_id
      LEFT JOIN districts d  ON d.district_id  = p.district_id
      WHERE p.status = 'active'
        AND p.deleted_at IS NULL
        AND pa.status = 'verified'
        AND (${dto.provinceId ?? null}::bigint IS NULL OR p.province_id = ${dto.provinceId ?? null}::bigint)
        AND (${dto.districtId ?? null}::bigint IS NULL OR p.district_id = ${dto.districtId ?? null}::bigint)
        AND (${dto.type ?? null}::text IS NULL OR p.property_type::text = ${dto.type ?? null}::text)
        AND (${dto.minPrice ?? null}::bigint IS NULL OR o.from_price >= ${dto.minPrice ?? null}::bigint)
        AND (${dto.maxPrice ?? null}::bigint IS NULL OR o.from_price <= ${dto.maxPrice ?? null}::bigint)
        AND (${dto.q ?? null}::text IS NULL
             -- Full-text match on name/description (handles multi-word,
             -- word-order-independent queries).
             OR p.search_vector @@ plainto_tsquery('simple', ${dto.q ?? null}::text)
             -- search_vector is a GENERATED column derived only from this
             -- row's own columns (a Postgres requirement for generated
             -- columns), so it can never contain province/district names —
             -- those live in joined tables. Match them here instead, plus a
             -- plain substring match on the name so partial words like
             -- "Praban" still find "Luang Prabang".
             OR p.property_name ILIKE '%' || ${dto.q ?? null}::text || '%'
             OR pv.province_name_lo ILIKE '%' || ${dto.q ?? null}::text || '%'
             OR pv.province_name_en ILIKE '%' || ${dto.q ?? null}::text || '%'
             OR d.district_name_lo ILIKE '%' || ${dto.q ?? null}::text || '%'
             OR d.district_name_en ILIKE '%' || ${dto.q ?? null}::text || '%'
             OR p.address_detail ILIKE '%' || ${dto.q ?? null}::text || '%')
        AND (NOT ${hasGeo}
             OR ST_DWithin(p.geog,
                  ST_SetSRID(ST_MakePoint(${dto.lng ?? 0}, ${dto.lat ?? 0}), 4326)::geography,
                  ${radiusMeters}))
      ORDER BY
        CASE WHEN ${dto.sort ?? 'rating'} = 'price_asc'  THEN o.from_price END ASC,
        CASE WHEN ${dto.sort ?? 'rating'} = 'price_desc' THEN o.from_price END DESC,
        CASE WHEN ${dto.sort ?? 'rating'} = 'reviews'    THEN p.review_count END DESC,
        CASE WHEN ${dto.sort ?? 'rating'} = 'distance' AND ${hasGeo}
             THEN ST_Distance(p.geog,
                    ST_SetSRID(ST_MakePoint(${dto.lng ?? 0}, ${dto.lat ?? 0}), 4326)::geography)
             END ASC,
        p.rating_avg DESC, p.review_count DESC, p.property_id ASC
      LIMIT ${dto.limit} OFFSET ${offset}
    `;

    const total = rows.length ? Number(rows[0].total_count) : 0;

    return {
      items: rows.map((r) => ({
        id: r.property_id.toString(),
        name: r.property_name,
        type: r.property_type,
        province: r.province_name_lo,
        district: r.district_name_lo,
        address: r.address_detail,
        lat: r.latitude ? Number(r.latitude.toString()) : null,
        lng: r.longitude ? Number(r.longitude.toString()) : null,
        rating: rateOf(r.rating_avg),
        reviewCount: r.review_count,
        coverImage: r.cover_image,
        fromPricePerNight: kipOf(r.from_price ?? 0n),
        staySubtotal: range ? kipOf(r.stay_total ?? 0n) : null,
        nights: range ? nights : null,
        availableRoomTypes: r.available_rooms,
        distanceKm: r.distance_m === null ? null : Math.round(Number(r.distance_m) / 100) / 10,
      })),
      total,
      page: dto.page,
      limit: dto.limit,
      pages: Math.max(1, Math.ceil(total / dto.limit)),
    };
  }

  /** Everything a property page shows: rooms, amenities, rules and reviews. */
  async findOne(propertyId: bigint, checkIn?: string, checkOut?: string) {
    const property = await this.prisma.properties.findFirst({
      // Ten nested relations, and Prisma's default is one round trip each. The
      // database is in Singapore at ~40ms a trip, which made this page cost
      // 800ms of waiting and almost no work. `join` answers it in one SQL
      // statement with LATERAL joins instead.
      relationLoadStrategy: 'join',
      where: {
        property_id: propertyId,
        status: 'active',
        deleted_at: null,
        partners: { status: 'verified' },
      },
      include: {
        provinces: true,
        districts: true,
        villages: true,
        cancellation_policies: true,
        property_rules: true,
        property_images: { orderBy: [{ is_cover: 'desc' }, { display_order: 'asc' }] },
        property_amenities: { include: { amenities: true } },
        partners: { select: { partner_id: true, business_name: true } },
        room_types: {
          where: { status: 'active', deleted_at: null },
          orderBy: { base_price: 'asc' },
          include: {
            room_type_images: { orderBy: [{ is_cover: 'desc' }, { display_order: 'asc' }] },
          },
        },
        reviews: {
          where: { status: 'published' },
          orderBy: { created_at: 'desc' },
          take: 20,
          include: { users: { include: { user_profiles: { select: { full_name: true } } } } },
        },
      },
    });

    if (!property) throw new NotFoundException(`ບໍ່ພົບທີ່ພັກ #${propertyId} · Property not found`);

    const range = this.parseRange(checkIn, checkOut);
    const priced = range
      ? await this.priceRoomTypes(propertyId, range.checkIn, range.checkOut)
      : null;

    return {
      id: property.property_id.toString(),
      name: property.property_name,
      type: property.property_type,
      description: property.description,
      phone: property.phone,
      province: property.provinces?.province_name_lo ?? null,
      district: property.districts?.district_name_lo ?? null,
      village: property.villages?.village_name_lo ?? null,
      address: property.address_detail,
      lat: property.latitude ? Number(property.latitude.toString()) : null,
      lng: property.longitude ? Number(property.longitude.toString()) : null,
      rating: rateOf(property.rating_avg),
      reviewCount: property.review_count,
      images: property.property_images.map((i) => ({
        url: i.image_url,
        thumbnailUrl: i.thumbnail_url ?? i.image_url,
        caption: i.caption,
        isCover: i.is_cover,
      })),
      amenities: property.property_amenities.map((pa) => ({
        id: pa.amenities.amenity_id.toString(),
        name: pa.amenities.amenity_name_lo,
        nameEn: pa.amenities.amenity_name_en,
        icon: pa.amenities.icon,
        category: pa.amenities.category,
      })),
      rules: property.property_rules
        ? {
            checkInFrom: property.property_rules.check_in_from,
            checkOutUntil: property.property_rules.check_out_until,
            smokingAllowed: property.property_rules.smoking_allowed,
            petAllowed: property.property_rules.pet_allowed,
            childAllowed: property.property_rules.child_allowed,
            partyAllowed: property.property_rules.party_allowed,
            quietHoursStart: property.property_rules.quiet_hours_start,
            quietHoursEnd: property.property_rules.quiet_hours_end,
            note: property.property_rules.additional_note,
          }
        : null,
      cancellationPolicy: property.cancellation_policies
        ? {
            name: property.cancellation_policies.policy_name,
            daysBeforeCheckin: property.cancellation_policies.days_before_checkin,
            penaltyPercent: rateOf(property.cancellation_policies.penalty_percent),
            isRefundable: property.cancellation_policies.is_refundable,
            description: property.cancellation_policies.description,
          }
        : null,
      host: {
        id: property.partners.partner_id.toString(),
        name: property.partners.business_name,
      },
      nights: range?.nights ?? null,
      roomTypes: property.room_types.map((rt) => {
        const offer = priced?.get(rt.room_type_id.toString());
        return {
          id: rt.room_type_id.toString(),
          name: rt.type_name,
          description: rt.description,
          bedType: rt.bed_type,
          hasAc: rt.has_ac,
          maxOccupancy: rt.max_occupancy,
          extraGuestFee: kipOf(rt.extra_guest_fee),
          sizeSqm: rt.size_sqm,
          basePrice: kipOf(rt.base_price),
          totalRooms: rt.total_rooms,
          minNights: rt.min_nights,
          images: rt.room_type_images.map((i) => i.image_url),
          /** Null when no dates were given — the base price applies. */
          stayTotal: offer ? kipOf(offer.stayTotal) : null,
          available: offer ? offer.available : null,
        };
      }),
      reviews: property.reviews.map((r) => ({
        id: r.review_id.toString(),
        stars: rateOf(r.overall_rating),
        title: r.title,
        comment: r.comment,
        guest: r.users.user_profiles?.full_name ?? '—',
        createdAt: r.created_at,
      })),
    };
  }

  /**
   * Night-by-night price and availability for every room type, for the date
   * picker. Gaps are filled rather than omitted: an absent `room_inventory`
   * row means "not on sale", and the client should not have to infer that.
   */
  async calendar(propertyId: bigint, query: CalendarQueryDto) {
    const from = utcMidnight(query.from);
    const to = utcMidnight(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      throw new BadRequestException('ຊ່ວງວັນທີບໍ່ຖືກຕ້ອງ · Invalid date range');
    }
    if ((to.getTime() - from.getTime()) / 86_400_000 > 366) {
      throw new BadRequestException('ຊ່ວງສູງສຸດ 366 ວັນ · Range may not exceed 366 days');
    }

    const roomTypes = await this.prisma.room_types.findMany({
      where: { property_id: propertyId, status: 'active', deleted_at: null },
      select: { room_type_id: true, type_name: true, base_price: true, total_rooms: true },
      orderBy: { base_price: 'asc' },
    });
    if (!roomTypes.length) return { propertyId: propertyId.toString(), roomTypes: [] };

    const ids = roomTypes.map((r) => r.room_type_id);
    const [inventory, prices] = await Promise.all([
      this.prisma.room_inventory.findMany({
        where: { room_type_id: { in: ids }, date: { gte: from, lt: to } },
      }),
      this.prisma.room_prices.findMany({
        where: { room_type_id: { in: ids }, date: { gte: from, lt: to } },
      }),
    ]);

    const inv = new Map(inventory.map((i) => [`${i.room_type_id}|${isoDayUtc(i.date)}`, i]));
    const prc = new Map(prices.map((p) => [`${p.room_type_id}|${isoDayUtc(p.date)}`, p]));

    return {
      propertyId: propertyId.toString(),
      roomTypes: roomTypes.map((rt) => {
        const days: { date: string; price: number; available: number; open: boolean }[] = [];
        for (let d = new Date(from); d < to; d = addDaysUtc(d, 1)) {
          const key = `${rt.room_type_id}|${isoDayUtc(d)}`;
          const i = inv.get(key);
          days.push({
            date: isoDayUtc(d),
            price: kipOf(prc.get(key)?.price ?? rt.base_price),
            available: i?.available_count ?? 0,
            open: i?.status === 'open',
          });
        }
        return {
          id: rt.room_type_id.toString(),
          name: rt.type_name,
          totalRooms: rt.total_rooms,
          days,
        };
      }),
    };
  }

  // ── master data ───────────────────────────────────────────────────────────

  async provinces() {
    const rows = await this.prisma.provinces.findMany({
      orderBy: { province_name_en: 'asc' },
      include: { _count: { select: { properties: true } } },
    });
    return rows.map((p) => ({
      id: p.province_id.toString(),
      code: p.province_code,
      name: p.province_name_lo,
      nameEn: p.province_name_en,
      propertyCount: p._count.properties,
    }));
  }

  async districts(provinceId?: number) {
    const rows = await this.prisma.districts.findMany({
      where: provinceId ? { province_id: BigInt(provinceId) } : {},
      orderBy: [{ province_id: 'asc' }, { district_name_en: 'asc' }],
    });
    return rows.map((d) => ({
      id: d.district_id.toString(),
      provinceId: d.province_id.toString(),
      code: d.district_code,
      name: d.district_name_lo,
      nameEn: d.district_name_en,
    }));
  }

  async amenities() {
    const rows = await this.prisma.amenities.findMany({
      where: { status: 'active' },
      orderBy: [{ category: 'asc' }, { amenity_name_en: 'asc' }],
    });
    return rows.map((a) => ({
      id: a.amenity_id.toString(),
      name: a.amenity_name_lo,
      nameEn: a.amenity_name_en,
      icon: a.icon,
      category: a.category,
    }));
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Stay total per room type, and whether every night has space. */
  private async priceRoomTypes(propertyId: bigint, checkIn: Date, checkOut: Date) {
    const rows = await this.prisma.$queryRaw<
      { room_type_id: bigint; stay_total: bigint; open_nights: bigint; nights: bigint }[]
    >`
      WITH nights AS (
        SELECT gs::date AS d
        FROM generate_series(${checkIn}::date, ${checkOut}::date - 1, '1 day') AS gs
      )
      SELECT rt.room_type_id,
             SUM(COALESCE(rp.price, rt.base_price))::bigint AS stay_total,
             COUNT(*) FILTER (
               WHERE ri.status = 'open' AND ri.available_count >= 1
             )::bigint AS open_nights,
             (SELECT COUNT(*) FROM nights)::bigint AS nights
      FROM room_types rt
      CROSS JOIN nights n
      LEFT JOIN room_prices    rp ON rp.room_type_id = rt.room_type_id AND rp.date = n.d
      LEFT JOIN room_inventory ri ON ri.room_type_id = rt.room_type_id AND ri.date = n.d
      WHERE rt.property_id = ${propertyId} AND rt.deleted_at IS NULL
      GROUP BY rt.room_type_id
    `;

    return new Map(
      rows.map((r) => [
        r.room_type_id.toString(),
        { stayTotal: r.stay_total, available: r.open_nights === r.nights },
      ]),
    );
  }

  /** Both dates or neither; returns null when the caller supplied neither. */
  private parseRange(checkIn?: string, checkOut?: string) {
    if (!checkIn && !checkOut) return null;
    if (!checkIn || !checkOut) {
      throw new BadRequestException(
        'ຕ້ອງໃສ່ທັງວັນເຂົ້າ ແລະ ວັນອອກ · Supply both check-in and check-out',
      );
    }

    const from = utcMidnight(checkIn);
    const to = utcMidnight(checkOut);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('ວັນທີບໍ່ຖືກຕ້ອງ · Invalid dates');
    }
    if (to <= from) {
      throw new BadRequestException('ວັນອອກຕ້ອງຫຼັງວັນເຂົ້າ · Check-out must be after check-in');
    }

    return { checkIn: from, checkOut: to, nights: (to.getTime() - from.getTime()) / 86_400_000 };
  }
}
