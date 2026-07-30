import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import {
  BOOKING_STATUS,
  PAYMENT_STATUS,
  AVAILABILITY_STATUS,
  cancellationSplit,
  nightsBetween,
  type BookingStatus,
} from '../../common/money';
import { bookingCode } from '../dashboard/dashboard.service';

export interface ListBookingsQuery extends PaginationDto {
  status?: BookingStatus;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async list(dto: ListBookingsQuery) {
    const where: Prisma.bookingsWhereInput = {};
    if (dto.status) where.status = dto.status;

    if (dto.q) {
      const q = dto.q.trim();
      const or: Prisma.bookingsWhereInput[] = [
        { properties: { name: { contains: q, mode: 'insensitive' } } },
        { users: { full_name: { contains: q, mode: 'insensitive' } } },
        { users: { email: { contains: q, mode: 'insensitive' } } },
      ];
      // "STL-2A83" and a bare id both resolve to the same booking.
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
          properties: { select: { id: true, name: true, province: true } },
          users: { select: { id: true, full_name: true, phone: true } },
          rooms: { select: { id: true, name: true, room_no: true } },
          payments: { select: { status: true, amount: true, paid_at: true } },
        },
      }),
      this.prisma.bookings.count({ where }),
    ]);

    return paged(rows.map(toListItem), total, dto);
  }

  async findOne(id: bigint) {
    const b = await this.prisma.bookings.findUnique({
      where: { id },
      include: {
        properties: { select: { id: true, name: true, province: true, address: true, partners: { select: { id: true, owner_name: true, phone: true } } } },
        users: { select: { id: true, full_name: true, email: true, phone: true, tier: true } },
        rooms: { select: { id: true, name: true, room_no: true, bed_type: true, has_ac: true } },
        payments: true,
        cancellations: true,
        booking_items: { include: { rooms: { select: { name: true, room_no: true } } } },
        reviews: { select: { id: true, stars: true, text: true, is_hidden: true } },
        promos: { select: { code: true, type: true, value: true } },
      },
    });

    if (!b) throw new NotFoundException(`ບໍ່ພົບການຈອງ #${id} · Booking not found`);

    return {
      ...b,
      code: bookingCode(b.id),
      nights: nightsBetween(b.check_in, b.check_out),
    };
  }

  async setStatus(id: bigint, status: BookingStatus) {
    const booking = await this.prisma.bookings.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException(`ບໍ່ພົບການຈອງ #${id} · Booking not found`);

    if (booking.status === BOOKING_STATUS.CANCELLED) {
      throw new BadRequestException(
        'ການຈອງນີ້ຍົກເລີກໄປແລ້ວ · Cannot change the status of a cancelled booking',
      );
    }
    if (status === BOOKING_STATUS.CANCELLED) {
      throw new BadRequestException(
        'ໃຫ້ໃຊ້ POST /cancel ເພື່ອຍົກເລີກ · Use the cancel endpoint so the refund is recorded',
      );
    }

    return this.prisma.bookings.update({ where: { id }, data: { status } });
  }

  /**
   * Cancel and refund, as one transaction.
   *
   * Three things must agree afterwards or the books are wrong: the booking is
   * cancelled, the cancellation row records fee vs refund, and the nights are
   * released back into `room_availability` so they can be sold again.
   */
  async cancel(id: bigint, reason: string | undefined) {
    const { cancellation_fee_rate } = await this.settings.get();

    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.bookings.findUnique({
        where: { id },
        include: { payments: true, cancellations: true },
      });

      if (!booking) throw new NotFoundException(`ບໍ່ພົບການຈອງ #${id} · Booking not found`);
      if (booking.status === BOOKING_STATUS.CANCELLED) {
        throw new BadRequestException('ຍົກເລີກໄປແລ້ວ · Booking is already cancelled');
      }
      if (booking.status === BOOKING_STATUS.DONE) {
        throw new BadRequestException(
          'ພັກຈົບແລ້ວ ຍົກເລີກບໍ່ໄດ້ · A completed stay cannot be cancelled',
        );
      }

      // Refund what was actually captured, not the booking total — an unpaid
      // booking refunds nothing.
      const paid = booking.payments
        .filter((p) => p.status === PAYMENT_STATUS.PAID)
        .reduce((sum, p) => sum + p.amount, 0);

      const { fee, refund } = cancellationSplit(paid, cancellation_fee_rate);

      await tx.bookings.update({
        where: { id },
        data: { status: BOOKING_STATUS.CANCELLED },
      });

      const cancellation = await tx.cancellations.create({
        data: {
          booking_id: id,
          reason: reason?.slice(0, 255) ?? 'ຍົກເລີກໂດຍຜູ້ດູແລ · Cancelled by admin',
          fee,
          refund_amount: refund,
        },
      });

      if (refund > 0) {
        await tx.payments.updateMany({
          where: { booking_id: id, status: PAYMENT_STATUS.PAID },
          data: { status: PAYMENT_STATUS.REFUNDED },
        });
      }

      await tx.room_availability.updateMany({
        where: {
          room_id: booking.room_id,
          date: { gte: booking.check_in, lt: booking.check_out },
          status: AVAILABILITY_STATUS.BOOKED,
        },
        data: { status: AVAILABILITY_STATUS.AVAILABLE },
      });

      await tx.notifications.create({
        data: {
          recipient_type: 'user',
          recipient_id: booking.user_id,
          title: 'ການຈອງຖືກຍົກເລີກ',
          body: `ການຈອງ ${bookingCode(id)} ຖືກຍົກເລີກ · ຄືນເງິນ ₭${refund.toLocaleString('en-US')}`,
          type: 'booking',
        },
      });

      return { booking: { id, status: BOOKING_STATUS.CANCELLED }, cancellation, paid, fee, refund };
    });
  }

  /** Counts per status, for the filter chips above the table. */
  async statusCounts() {
    const rows = await this.prisma.bookings.groupBy({ by: ['status'], _count: true });
    const counts: Record<string, number> = {};
    let all = 0;
    for (const r of rows) {
      counts[r.status ?? 'unknown'] = r._count;
      all += r._count;
    }
    return { all, ...counts };
  }
}

function toListItem(b: {
  id: bigint;
  check_in: Date;
  check_out: Date;
  guests: number;
  subtotal: number;
  fee: number;
  total: number;
  status: string | null;
  source: string | null;
  created_at: Date | null;
  properties: { id: bigint; name: string; province: string };
  users: { id: bigint; full_name: string; phone: string };
  rooms: { id: bigint; name: string; room_no: string | null };
  payments: { status: string | null; amount: number; paid_at: Date | null }[];
}) {
  return {
    id: b.id,
    code: bookingCode(b.id),
    property: b.properties.name,
    propertyId: b.properties.id,
    province: b.properties.province,
    guest: b.users.full_name,
    guestPhone: b.users.phone,
    room: b.rooms.room_no ?? b.rooms.name,
    checkIn: b.check_in,
    checkOut: b.check_out,
    nights: nightsBetween(b.check_in, b.check_out),
    guests: b.guests,
    subtotal: b.subtotal,
    fee: b.fee,
    total: b.total,
    status: b.status,
    source: b.source,
    paymentStatus: b.payments[0]?.status ?? null,
    createdAt: b.created_at,
  };
}

/**
 * Resolves a search term to candidate booking ids.
 *
 * `bookingCode` renders the id in hex, so "STL-0142" means id 322 — but a hex
 * code can be all digits, which is indistinguishable from someone pasting a raw
 * id. Rather than guess, both readings are returned and matched with `IN`:
 *
 *   "STL-0142" → [322]        (prefixed: unambiguously hex)
 *   "142"      → [322, 142]   (bare: could be either)
 *   "2A83"     → [10883]      (has hex letters: only one reading)
 */
function parseBookingRef(input: string): bigint[] {
  const trimmed = input.trim().toUpperCase();
  const hadPrefix = trimmed.startsWith('STL-');
  const cleaned = hadPrefix ? trimmed.slice(4) : trimmed;

  if (!/^[0-9A-F]+$/.test(cleaned) || cleaned.length > 15) return [];

  const candidates: bigint[] = [];
  try {
    candidates.push(BigInt('0x' + cleaned));
  } catch {
    /* not parseable as hex */
  }
  if (!hadPrefix && /^\d+$/.test(cleaned)) {
    try {
      const asDecimal = BigInt(cleaned);
      if (!candidates.includes(asDecimal)) candidates.push(asDecimal);
    } catch {
      /* not parseable as decimal */
    }
  }
  return candidates;
}
