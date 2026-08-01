import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { OwnershipService } from '../ownership.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import {
  BOOKING_SOURCE,
  BOOKING_STATUS,
  bookingCode,
  nightsBetween,
  parseBookingRef,
  type BookingStatus,
} from '../../common/money';
import { ACTOR } from '../../common/actors';
import { holdNights, quoteStay } from '../../common/booking-pricing';
import type { WalkInDto } from './bookings.dto';

export interface ListPartnerBookingsQuery extends PaginationDto {
  status?: BookingStatus;
}

/**
 * Which status a partner may move a booking to, from where.
 *
 * Cancellation is deliberately absent: it moves money, so it goes through
 * CancellationService via its own endpoint.
 */
const ALLOWED_TRANSITIONS: Record<string, BookingStatus[]> = {
  [BOOKING_STATUS.PENDING]: [BOOKING_STATUS.CONFIRMED],
  [BOOKING_STATUS.CONFIRMED]: [BOOKING_STATUS.STAYING],
  [BOOKING_STATUS.STAYING]: [BOOKING_STATUS.DONE],
};

@Injectable()
export class PartnerBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly own: OwnershipService,
  ) {}

  async list(partnerId: bigint, dto: ListPartnerBookingsQuery) {
    // Scoped in the query, not filtered after: an empty result is the safe
    // failure mode, another partner's bookings is not.
    const where: Prisma.bookingsWhereInput = { properties: { partner_id: partnerId } };
    if (dto.status) where.status = dto.status;

    if (dto.q) {
      const q = dto.q.trim();
      const or: Prisma.bookingsWhereInput[] = [
        { users: { full_name: { contains: q, mode: 'insensitive' } } },
        { users: { phone: { contains: q } } },
      ];
      const ids = parseBookingRef(q);
      if (ids.length) or.push({ id: { in: ids } });
      where.OR = or;
    }

    const [rows, total] = await Promise.all([
      this.prisma.bookings.findMany({
        where,
        skip: dto.skip,
        take: dto.limit,
        orderBy: { created_at: 'desc' },
        include: {
          properties: { select: { id: true, name: true } },
          users: { select: { id: true, full_name: true, phone: true } },
          rooms: { select: { id: true, name: true, room_no: true } },
          payments: { select: { status: true, amount: true } },
        },
      }),
      this.prisma.bookings.count({ where }),
    ]);

    return paged(rows.map(toListItem), total, dto);
  }

  async findOne(partnerId: bigint, id: bigint) {
    await this.own.assertOwnsBooking(partnerId, id);

    const b = await this.prisma.bookings.findUniqueOrThrow({
      where: { id },
      include: {
        properties: { select: { id: true, name: true, province: true } },
        users: { select: { id: true, full_name: true, email: true, phone: true, tier: true } },
        rooms: { select: { id: true, name: true, room_no: true, bed_type: true, has_ac: true } },
        payments: { select: { id: true, status: true, amount: true, paid_at: true, method: true } },
        cancellations: true,
        booking_items: true,
        reviews: { select: { id: true, stars: true, text: true, is_hidden: true } },
        promos: { select: { code: true, type: true, value: true } },
      },
    });

    return { ...b, code: bookingCode(b.id), nights: nightsBetween(b.check_in, b.check_out) };
  }

  async statusCounts(partnerId: bigint) {
    const rows = await this.prisma.bookings.groupBy({
      by: ['status'],
      where: { properties: { partner_id: partnerId } },
      _count: true,
    });
    const counts: Record<string, number> = {};
    let all = 0;
    for (const r of rows) {
      counts[r.status ?? 'unknown'] = r._count;
      all += r._count;
    }
    return { all, ...counts };
  }

  /** Check-in / check-out, following the one-way status ladder. */
  async setStatus(partnerId: bigint, id: bigint, status: BookingStatus) {
    await this.own.assertOwnsBooking(partnerId, id);

    const booking = await this.prisma.bookings.findUniqueOrThrow({ where: { id } });
    const from = booking.status ?? BOOKING_STATUS.CONFIRMED;
    const allowed = ALLOWED_TRANSITIONS[from] ?? [];

    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `ປ່ຽນຈາກ "${from}" ໄປ "${status}" ບໍ່ໄດ້ · Cannot move a booking from "${from}" to "${status}"` +
          (allowed.length ? ` (allowed: ${allowed.join(', ')})` : ''),
      );
    }

    return this.prisma.bookings.update({ where: { id }, data: { status } });
  }

  /**
   * A guest who walked in and paid at the desk.
   *
   * Recorded as a real booking so the room calendar, the reviews and the payout
   * all see it — `source = walk_in` is what makes it commission at the lower
   * walk-in rate. The guest may not have an account, so one is created from
   * their phone number; a repeat walk-in matches the existing row instead of
   * piling up duplicates.
   */
  async createWalkIn(partnerId: bigint, dto: WalkInDto) {
    const roomId = BigInt(dto.roomId);
    const propertyId = await this.own.assertOwnsRoom(partnerId, roomId);
    const { service_fee_rate } = await this.settings.get();

    return this.prisma.$transaction(async (tx) => {
      const quote = await quoteStay(tx, {
        roomId,
        checkIn: new Date(dto.checkIn),
        checkOut: new Date(dto.checkOut),
        guests: dto.guests,
        serviceFeeRate: service_fee_rate,
        walkIn: true,
      });

      const room = await tx.rooms.findUniqueOrThrow({
        where: { id: roomId },
        select: { qty: true },
      });

      const checkIn = new Date(quote.perNight[0].date + 'T00:00:00.000Z');
      const checkOut = new Date(
        new Date(quote.perNight[quote.perNight.length - 1].date + 'T00:00:00.000Z').getTime() +
          86_400_000,
      );

      await holdNights(tx, roomId, checkIn, checkOut, room.qty, quote.perNight);

      const guest = await this.findOrCreateWalkInGuest(tx, dto);

      const booking = await tx.bookings.create({
        data: {
          user_id: guest.id,
          property_id: propertyId,
          room_id: roomId,
          source: BOOKING_SOURCE.WALK_IN,
          check_in: checkIn,
          check_out: checkOut,
          guests: dto.guests,
          subtotal: quote.subtotal,
          fee: quote.fee,
          discount: quote.discount,
          total: quote.total,
          // Money already changed hands at the desk.
          status: BOOKING_STATUS.CONFIRMED,
        },
      });

      await tx.booking_items.create({
        data: {
          booking_id: booking.id,
          room_id: roomId,
          nights: quote.nights,
          price_per_night: Math.round(quote.subtotal / quote.nights),
        },
      });

      await tx.notifications.create({
        data: {
          recipient_type: ACTOR.PARTNER,
          recipient_id: partnerId,
          title: 'ບັນທຶກການເຂົ້າພັກແລ້ວ',
          body: `${bookingCode(booking.id)} · ${guest.full_name} · ₭${quote.total.toLocaleString('en-US')}`,
          type: 'booking',
        },
      });

      return {
        ...booking,
        code: bookingCode(booking.id),
        guest: { id: guest.id, fullName: guest.full_name, phone: guest.phone },
        quote,
      };
    });
  }

  /**
   * Walk-in guests rarely have an account. Match on phone first — the same
   * person returning should not become a second customer — then on email if one
   * was given, and only create as a last resort.
   */
  private async findOrCreateWalkInGuest(tx: Prisma.TransactionClient, dto: WalkInDto) {
    const existing = await tx.users.findFirst({
      where: dto.guestEmail
        ? { OR: [{ phone: dto.guestPhone }, { email: dto.guestEmail }] }
        : { phone: dto.guestPhone },
    });
    if (existing) return existing;

    // A placeholder address keeps the unique index happy for a guest with no
    // email; the random password means the row cannot be logged into until the
    // guest registers properly and resets it.
    const email = dto.guestEmail ?? `walkin+${randomBytes(6).toString('hex')}@laostay.la`;
    const password_hash = await argon2.hash(randomBytes(32).toString('hex'), {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    return tx.users.create({
      data: {
        email,
        phone: dto.guestPhone,
        full_name: dto.guestName,
        password_hash,
        is_verified: false,
      },
    });
  }
}

function toListItem(b: {
  id: bigint;
  check_in: Date;
  check_out: Date;
  guests: number;
  subtotal: number;
  fee: number;
  discount: number;
  total: number;
  status: string | null;
  source: string | null;
  created_at: Date | null;
  properties: { id: bigint; name: string };
  users: { id: bigint; full_name: string; phone: string };
  rooms: { id: bigint; name: string; room_no: string | null };
  payments: { status: string | null; amount: number }[];
}) {
  return {
    id: b.id,
    code: bookingCode(b.id),
    propertyId: b.properties.id,
    property: b.properties.name,
    guest: b.users.full_name,
    guestPhone: b.users.phone,
    room: b.rooms.room_no ?? b.rooms.name,
    checkIn: b.check_in,
    checkOut: b.check_out,
    nights: nightsBetween(b.check_in, b.check_out),
    guests: b.guests,
    subtotal: b.subtotal,
    fee: b.fee,
    discount: b.discount,
    total: b.total,
    status: b.status,
    source: b.source,
    paymentStatus: b.payments[0]?.status ?? null,
    createdAt: b.created_at,
  };
}
