import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CancellationService } from '../../common/cancellation.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import {
  BOOKING_STATUS,
  nightsBetween,
  bookingCode,
  parseBookingRef,
  type BookingStatus,
} from '../../common/money';
import { ACTOR } from '../../common/actors';

export interface ListBookingsQuery extends PaginationDto {
  status?: BookingStatus;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cancellations: CancellationService,
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
   * Cancel and refund. The work itself lives in CancellationService because a
   * guest cancelling in the app must produce exactly the same rows.
   */
  async cancel(id: bigint, reason: string | undefined) {
    return this.cancellations.cancel(id, reason, ACTOR.ADMIN);
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
