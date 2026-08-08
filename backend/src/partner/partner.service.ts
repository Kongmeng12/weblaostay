import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, booking_status, payout_status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../booking/inventory.service';
import { OwnershipService } from './ownership.service';
import { kipOf, rateOf, toKip } from '../common/money';
import { addDaysUtc, todayUtc, utcMidnight } from '../common/dates';
import { REVENUE_STATUSES } from '../common/enums';
import type {
  RoomTypeDto,
  SetInventoryDto,
  SetPriceDto,
  UpdatePropertyDto,
  UpdateRoomTypeDto,
} from './partner.dto';

@Injectable()
export class PartnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly own: OwnershipService,
  ) {}

  // ── properties ────────────────────────────────────────────────────────────

  async properties(partnerId: bigint) {
    const rows = await this.prisma.properties.findMany({
      where: { partner_id: partnerId, deleted_at: null },
      orderBy: { property_id: 'asc' },
      include: {
        provinces: { select: { province_name_lo: true } },
        districts: { select: { district_name_lo: true } },
        property_images: { orderBy: [{ is_cover: 'desc' }, { display_order: 'asc' }] },
        property_amenities: { select: { amenity_id: true } },
        room_types: {
          where: { deleted_at: null },
          orderBy: { base_price: 'asc' },
          include: { room_type_images: { orderBy: { display_order: 'asc' } } },
        },
        _count: { select: { bookings: true, reviews: true } },
      },
    });

    return rows.map((p) => ({
      id: p.property_id.toString(),
      name: p.property_name,
      type: p.property_type,
      description: p.description,
      phone: p.phone,
      province: p.provinces?.province_name_lo ?? null,
      district: p.districts?.district_name_lo ?? null,
      address: p.address_detail,
      lat: p.latitude ? Number(p.latitude.toString()) : null,
      lng: p.longitude ? Number(p.longitude.toString()) : null,
      rating: rateOf(p.rating_avg),
      reviewCount: p.review_count,
      status: p.status,
      amenityIds: p.property_amenities.map((a) => a.amenity_id.toString()),
      images: p.property_images.map((i) => ({
        id: i.property_image_id.toString(),
        url: i.image_url,
        isCover: i.is_cover,
      })),
      roomTypes: p.room_types.map(toRoomTypeView),
      bookingCount: p._count.bookings,
    }));
  }

  async updateProperty(partnerId: bigint, propertyId: bigint, dto: UpdatePropertyDto) {
    await this.own.assertOwnsProperty(partnerId, propertyId);

    await this.prisma.$transaction(async (tx) => {
      await tx.properties.update({
        where: { property_id: propertyId },
        data: {
          ...(dto.name !== undefined && { property_name: dto.name }),
          ...(dto.type !== undefined && { property_type: dto.type }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.provinceId !== undefined && { province_id: BigInt(dto.provinceId) }),
          ...(dto.districtId !== undefined && { district_id: BigInt(dto.districtId) }),
          ...(dto.address !== undefined && { address_detail: dto.address }),
          ...(dto.lat !== undefined && { latitude: new Prisma.Decimal(dto.lat) }),
          ...(dto.lng !== undefined && { longitude: new Prisma.Decimal(dto.lng) }),
          ...(dto.cancellationPolicyId !== undefined && {
            cancellation_policy_id: BigInt(dto.cancellationPolicyId),
          }),
        },
      });

      // Amenities are a set, so a supplied list replaces rather than merges —
      // otherwise unticking one in the app would do nothing.
      if (dto.amenityIds) {
        await tx.property_amenities.deleteMany({ where: { property_id: propertyId } });
        if (dto.amenityIds.length) {
          await tx.property_amenities.createMany({
            data: dto.amenityIds.map((id) => ({
              property_id: propertyId,
              amenity_id: BigInt(id),
            })),
            skipDuplicates: true,
          });
        }
      }
    });

    return this.properties(partnerId);
  }

  // ── room types ────────────────────────────────────────────────────────────

  async createRoomType(partnerId: bigint, propertyId: bigint, dto: RoomTypeDto) {
    await this.own.assertVerified(partnerId);
    await this.own.assertOwnsProperty(partnerId, propertyId);

    const created = await this.prisma.room_types.create({
      data: {
        property_id: propertyId,
        type_name: dto.name,
        description: dto.description ?? null,
        bed_type: dto.bedType,
        has_ac: dto.hasAc ?? true,
        max_occupancy: dto.maxOccupancy,
        base_price: toKip(dto.basePrice),
        total_rooms: dto.totalRooms,
        min_nights: dto.minNights ?? 1,
        extra_guest_fee: toKip(dto.extraGuestFee ?? 0),
        size_sqm: dto.sizeSqm ?? null,
      },
      include: { room_type_images: true },
    });

    return toRoomTypeView(created);
  }

  async updateRoomType(partnerId: bigint, roomTypeId: bigint, dto: UpdateRoomTypeDto) {
    await this.own.assertOwnsRoomType(partnerId, roomTypeId);

    const updated = await this.prisma.room_types.update({
      where: { room_type_id: roomTypeId },
      data: {
        ...(dto.name !== undefined && { type_name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.bedType !== undefined && { bed_type: dto.bedType }),
        ...(dto.hasAc !== undefined && { has_ac: dto.hasAc }),
        ...(dto.maxOccupancy !== undefined && { max_occupancy: dto.maxOccupancy }),
        ...(dto.basePrice !== undefined && { base_price: toKip(dto.basePrice) }),
        ...(dto.totalRooms !== undefined && { total_rooms: dto.totalRooms }),
        ...(dto.minNights !== undefined && { min_nights: dto.minNights }),
        ...(dto.extraGuestFee !== undefined && { extra_guest_fee: toKip(dto.extraGuestFee) }),
        ...(dto.sizeSqm !== undefined && { size_sqm: dto.sizeSqm }),
        ...(dto.isActive !== undefined && { status: dto.isActive ? 'active' : 'inactive' }),
      },
      include: { room_type_images: true },
    });

    return toRoomTypeView(updated);
  }

  /**
   * Room types are never hard-deleted once they carry history: a booking row
   * points at them and the guest is entitled to see what they booked. Soft
   * delete takes it off sale, which is what "delete" means to the partner.
   */
  async removeRoomType(partnerId: bigint, roomTypeId: bigint) {
    await this.own.assertOwnsRoomType(partnerId, roomTypeId);

    const bookings = await this.prisma.booking_items.count({
      where: { room_type_id: roomTypeId },
    });

    if (bookings > 0) {
      await this.prisma.room_types.update({
        where: { room_type_id: roomTypeId },
        data: { status: 'inactive', deleted_at: new Date() },
      });
      return { deleted: false, deactivated: true, bookings };
    }

    await this.prisma.$transaction([
      this.prisma.room_inventory.deleteMany({ where: { room_type_id: roomTypeId } }),
      this.prisma.room_prices.deleteMany({ where: { room_type_id: roomTypeId } }),
      this.prisma.room_type_images.deleteMany({ where: { room_type_id: roomTypeId } }),
      this.prisma.room_types.delete({ where: { room_type_id: roomTypeId } }),
    ]);
    return { deleted: true, deactivated: false, bookings: 0 };
  }

  // ── inventory & prices ────────────────────────────────────────────────────

  /**
   * Opens or closes nights, and sets how many rooms are on sale.
   *
   * Lowering `total_count` below what is already sold is refused by the
   * database CHECK, which is the right answer — those guests are already
   * booked, and the partner needs to see that rather than silently oversell.
   */
  async setInventory(partnerId: bigint, roomTypeId: bigint, dto: SetInventoryDto) {
    await this.own.assertVerified(partnerId);
    await this.own.assertOwnsRoomType(partnerId, roomTypeId);

    const { from, to } = this.parseRange(dto.from, dto.to);
    const roomType = await this.prisma.room_types.findUniqueOrThrow({
      where: { room_type_id: roomTypeId },
      select: { total_rooms: true },
    });

    try {
      const affected = await this.prisma.$transaction((tx) =>
        this.inventory.openRange(
          tx,
          roomTypeId,
          from,
          to,
          dto.totalCount ?? roomType.total_rooms,
          dto.status ?? 'open',
        ),
      );
      return { roomTypeId: roomTypeId.toString(), nights: affected };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        String(err.meta?.constraint ?? '').includes('no_overbook')
      ) {
        throw new BadRequestException(
          'ຫຼຸດຈຳນວນຫ້ອງລົງຕ່ຳກວ່າທີ່ຂາຍໄປແລ້ວບໍ່ໄດ້ · ' +
            'Cannot reduce room count below what is already sold on those dates',
        );
      }
      throw err;
    }
  }

  async setPrice(partnerId: bigint, roomTypeId: bigint, dto: SetPriceDto) {
    await this.own.assertVerified(partnerId);
    await this.own.assertOwnsRoomType(partnerId, roomTypeId);

    const { from, to } = this.parseRange(dto.from, dto.to);
    const affected = await this.prisma.$transaction((tx) =>
      this.inventory.priceRange(
        tx,
        roomTypeId,
        from,
        to,
        toKip(dto.price),
        dto.priceType ?? 'weekday',
      ),
    );
    return { roomTypeId: roomTypeId.toString(), nights: affected };
  }

  /** The pricing calendar: one entry per night, gaps filled. */
  async calendar(partnerId: bigint, roomTypeId: bigint, fromIso: string, toIso: string) {
    await this.own.assertOwnsRoomType(partnerId, roomTypeId);
    const { from, to } = this.parseRange(fromIso, toIso);

    const rows = await this.prisma.$queryRaw<
      {
        day: string;
        price: bigint;
        total_count: number | null;
        held_count: number | null;
        booked_count: number | null;
        available_count: number | null;
        status: string | null;
      }[]
    >`
      WITH nights AS (
        SELECT gs::date AS d
        FROM generate_series(${from}::date, ${to}::date - 1, '1 day') AS gs
      )
      SELECT to_char(n.d, 'YYYY-MM-DD')          AS day,
             COALESCE(rp.price, rt.base_price)   AS price,
             ri.total_count, ri.held_count, ri.booked_count, ri.available_count,
             ri.status::text
      FROM nights n
      CROSS JOIN room_types rt
      LEFT JOIN room_prices    rp ON rp.room_type_id = rt.room_type_id AND rp.date = n.d
      LEFT JOIN room_inventory ri ON ri.room_type_id = rt.room_type_id AND ri.date = n.d
      WHERE rt.room_type_id = ${roomTypeId}
      ORDER BY n.d
    `;

    return {
      roomTypeId: roomTypeId.toString(),
      days: rows.map((r) => ({
        date: r.day,
        price: kipOf(r.price),
        total: r.total_count ?? 0,
        held: r.held_count ?? 0,
        booked: r.booked_count ?? 0,
        available: r.available_count ?? 0,
        // A night with no inventory row was never opened for sale.
        onSale: r.status === 'open',
      })),
    };
  }

  // ── bookings ──────────────────────────────────────────────────────────────

  async bookings(
    partnerId: bigint,
    query: { skip: number; limit: number; page: number; status?: booking_status; q?: string },
  ) {
    const where: Prisma.bookingsWhereInput = {
      properties: { partner_id: partnerId },
      deleted_at: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { booking_code: { contains: query.q.trim(), mode: 'insensitive' } },
              {
                users: {
                  user_profiles: { full_name: { contains: query.q.trim(), mode: 'insensitive' } },
                },
              },
              { users: { phone: { contains: query.q.trim() } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.bookings.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        include: {
          properties: { select: { property_id: true, property_name: true } },
          users: { include: { user_profiles: { select: { full_name: true } } } },
          booking_items: { include: { room_types: { select: { type_name: true } } } },
          payments: { select: { status: true }, orderBy: { created_at: 'desc' }, take: 1 },
        },
      }),
      this.prisma.bookings.count({ where }),
    ]);

    return {
      items: rows.map((b) => ({
        id: b.booking_id.toString(),
        code: b.booking_code,
        propertyId: b.properties.property_id.toString(),
        property: b.properties.property_name,
        guest: b.users.user_profiles?.full_name ?? '—',
        guestPhone: b.users.phone,
        roomType: b.booking_items[0]?.room_types.type_name ?? null,
        quantity: b.booking_items[0]?.quantity ?? 1,
        checkIn: b.check_in,
        checkOut: b.check_out,
        nights: b.nights,
        guests: b.total_guests,
        total: kipOf(b.total_amount),
        payout: kipOf(b.payout_amount),
        status: b.status,
        source: b.source,
        paymentStatus: b.payments[0]?.status ?? null,
        createdAt: b.created_at,
      })),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async statusCounts(partnerId: bigint) {
    const rows = await this.prisma.bookings.groupBy({
      by: ['status'],
      where: { properties: { partner_id: partnerId }, deleted_at: null },
      _count: true,
    });
    const counts: Record<string, number> = {};
    let all = 0;
    for (const r of rows) {
      counts[r.status] = r._count;
      all += r._count;
    }
    return { all, ...counts };
  }

  // ── payouts ───────────────────────────────────────────────────────────────

  /** Read-only: money leaves the platform only when finance releases it. */
  async payouts(partnerId: bigint, limit = 20) {
    const rows = await this.prisma.payouts.findMany({
      where: { partner_id: partnerId },
      orderBy: { period_start: 'desc' },
      take: limit,
      include: {
        partner_bank_accounts: { select: { bank_name: true, account_number: true } },
        _count: { select: { payout_items: true } },
      },
    });

    const pending = rows.filter((p) => p.status === payout_status.pending);

    return {
      items: rows.map((p) => ({
        id: p.payout_id.toString(),
        periodStart: p.period_start,
        periodEnd: p.period_end,
        gross: kipOf(p.gross_amount),
        commission: kipOf(p.commission_amount),
        net: kipOf(p.net_amount),
        status: p.status,
        paidAt: p.paid_at,
        bookings: p._count.payout_items,
        bank: p.partner_bank_accounts
          ? {
              name: p.partner_bank_accounts.bank_name,
              // Only the last digits ever leave the server.
              account: `***${p.partner_bank_accounts.account_number.slice(-4)}`,
            }
          : null,
      })),
      pendingCount: pending.length,
      pendingTotal: kipOf(pending.reduce((sum, p) => sum + p.net_amount, 0n)),
      paidTotal: kipOf(
        rows.filter((p) => p.status === payout_status.paid).reduce((s, p) => s + p.net_amount, 0n),
      ),
    };
  }

  /** The bookings that make up one payout — the reconciliation view. */
  async payoutItems(partnerId: bigint, payoutId: bigint) {
    const payout = await this.prisma.payouts.findFirst({
      where: { payout_id: payoutId, partner_id: partnerId },
      include: {
        payout_items: { include: { bookings: { select: { booking_code: true, check_out: true } } } },
      },
    });
    if (!payout) return { items: [] };

    return {
      id: payout.payout_id.toString(),
      gross: kipOf(payout.gross_amount),
      commission: kipOf(payout.commission_amount),
      net: kipOf(payout.net_amount),
      items: payout.payout_items.map((i) => ({
        bookingId: i.booking_id.toString(),
        code: i.bookings.booking_code,
        checkOut: i.bookings.check_out,
        gross: kipOf(i.gross_amount),
        commission: kipOf(i.commission_amount),
        net: kipOf(i.net_amount),
      })),
    };
  }

  // ── dashboard ─────────────────────────────────────────────────────────────

  async dashboard(partnerId: bigint) {
    const propertyIds = await this.own.propertyIds(partnerId);
    const today = todayUtc();
    const tomorrow = addDaysUtc(today, 1);
    const weekAgo = addDaysUtc(today, -7);

    if (!propertyIds.length) {
      return {
        today: { arrivals: [], arrivalCount: 0, departureCount: 0, stayingCount: 0 },
        pendingBookings: 0,
        occupancy: { soldTonight: 0, capacity: 0, percent: 0 },
        week: { bookings: 0, gross: 0, commission: 0, net: 0 },
        payoutPending: { count: 0, amount: 0 },
        unreadNotifications: 0,
      };
    }

    const scope = { property_id: { in: propertyIds }, deleted_at: null };

    const [arrivals, departures, staying, pending, weekRows, capacity, soldTonight, payoutAgg] =
      await Promise.all([
        this.prisma.bookings.findMany({
          where: { ...scope, check_in: today, status: { not: booking_status.cancelled } },
          include: {
            users: { include: { user_profiles: { select: { full_name: true } } } },
            booking_items: { include: { room_types: { select: { type_name: true } } } },
          },
          orderBy: { booking_id: 'asc' },
        }),
        this.prisma.bookings.count({
          where: { ...scope, check_out: today, status: booking_status.staying },
        }),
        this.prisma.bookings.count({ where: { ...scope, status: booking_status.staying } }),
        this.prisma.bookings.count({ where: { ...scope, status: booking_status.pending } }),
        this.prisma.bookings.findMany({
          where: {
            ...scope,
            status: { in: REVENUE_STATUSES },
            check_out: { gte: weekAgo, lt: tomorrow },
          },
          select: { total_amount: true, commission_amount: true, payout_amount: true },
        }),
        this.prisma.room_inventory.aggregate({
          where: { room_types: { property_id: { in: propertyIds } }, date: today },
          _sum: { total_count: true },
        }),
        this.prisma.room_inventory.aggregate({
          where: { room_types: { property_id: { in: propertyIds } }, date: today },
          _sum: { booked_count: true },
        }),
        this.prisma.payouts.aggregate({
          where: { partner_id: partnerId, status: payout_status.pending },
          _sum: { net_amount: true },
          _count: true,
        }),
      ]);

    const totalRooms = capacity._sum.total_count ?? 0;
    const sold = soldTonight._sum.booked_count ?? 0;

    return {
      today: {
        date: today,
        arrivals: arrivals.map((b) => ({
          id: b.booking_id.toString(),
          code: b.booking_code,
          guest: b.users.user_profiles?.full_name ?? '—',
          phone: b.users.phone,
          roomType: b.booking_items[0]?.room_types.type_name ?? null,
          guests: b.total_guests,
          status: b.status,
        })),
        arrivalCount: arrivals.length,
        departureCount: departures,
        stayingCount: staying,
      },
      pendingBookings: pending,
      occupancy: {
        soldTonight: sold,
        capacity: totalRooms,
        percent: totalRooms ? Math.round((sold / totalRooms) * 100) : 0,
      },
      week: {
        bookings: weekRows.length,
        gross: kipOf(weekRows.reduce((s, b) => s + b.total_amount, 0n)),
        commission: kipOf(weekRows.reduce((s, b) => s + b.commission_amount, 0n)),
        net: kipOf(weekRows.reduce((s, b) => s + b.payout_amount, 0n)),
      },
      payoutPending: {
        count: payoutAgg._count,
        amount: kipOf(payoutAgg._sum.net_amount ?? 0n),
      },
      unreadNotifications: 0,
    };
  }

  /** Both ends are calendar days; `to` is exclusive, like a stay's check-out. */
  private parseRange(fromIso: string, toIso: string) {
    const from = utcMidnight(fromIso);
    const to = utcMidnight(toIso);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      throw new BadRequestException('ຊ່ວງວັນທີບໍ່ຖືກຕ້ອງ · Invalid date range');
    }
    if ((to.getTime() - from.getTime()) / 86_400_000 > 366) {
      throw new BadRequestException('ຊ່ວງສູງສຸດ 366 ວັນ · Range may not exceed 366 days');
    }
    return { from, to };
  }
}

function toRoomTypeView(rt: {
  room_type_id: bigint;
  property_id: bigint;
  type_name: string;
  description: string | null;
  bed_type: string;
  has_ac: boolean;
  max_occupancy: number;
  extra_guest_fee: bigint;
  size_sqm: number | null;
  base_price: bigint;
  total_rooms: number;
  min_nights: number;
  status: string;
  room_type_images?: { room_image_id: bigint; image_url: string; is_cover: boolean }[];
}) {
  return {
    id: rt.room_type_id.toString(),
    propertyId: rt.property_id.toString(),
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
    isActive: rt.status === 'active',
    images: (rt.room_type_images ?? []).map((i) => ({
      id: i.room_image_id.toString(),
      url: i.image_url,
      isCover: i.is_cover,
    })),
  };
}
