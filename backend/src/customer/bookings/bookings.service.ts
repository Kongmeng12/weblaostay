import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import {
  BOOKING_SOURCE,
  BOOKING_STATUS,
  bookingCode,
  nightsBetween,
} from '../../common/money';
import { ACTOR } from '../../common/actors';
import { recalcPropertyRating } from '../../common/reviews';
import { holdNights, quoteStay, assertStayDates } from '../../common/booking-pricing';
import type { CreateBookingDto, CreateReviewDto } from './bookings.dto';

@Injectable()
export class CustomerBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Price a stay without booking it — the checkout screen's summary.
   *
   * Runs the exact same `quoteStay` the booking transaction runs, so the guest
   * cannot be shown one total and charged another.
   */
  async quote(dto: CreateBookingDto) {
    const { service_fee_rate } = await this.settings.get();
    const { checkIn, checkOut } = assertStayDates(dto.checkIn, dto.checkOut);

    return quoteStay(this.prisma, {
      roomId: BigInt(dto.roomId),
      checkIn,
      checkOut,
      guests: dto.guests,
      promoCode: dto.promoCode,
      serviceFeeRate: service_fee_rate,
    });
  }

  /**
   * Create a booking.
   *
   * Everything below happens in one transaction because a half-written booking
   * is worse than none: a `bookings` row whose nights were never held would be
   * sold twice, and nights held without a booking row would be unsellable
   * forever. `holdNights` takes the row locks that make two simultaneous guests
   * resolve to one winner and one 409.
   */
  async create(userId: bigint, dto: CreateBookingDto) {
    const { service_fee_rate } = await this.settings.get();
    const roomId = BigInt(dto.roomId);
    const { checkIn, checkOut } = assertStayDates(dto.checkIn, dto.checkOut);

    return this.prisma.$transaction(async (tx) => {
      const quote = await quoteStay(tx, {
        roomId,
        checkIn,
        checkOut,
        guests: dto.guests,
        promoCode: dto.promoCode,
        serviceFeeRate: service_fee_rate,
      });

      const room = await tx.rooms.findUniqueOrThrow({
        where: { id: roomId },
        select: { qty: true, property_id: true, properties: { select: { partner_id: true, name: true } } },
      });

      await holdNights(tx, roomId, checkIn, checkOut, room.qty, quote.perNight);

      const booking = await tx.bookings.create({
        data: {
          user_id: userId,
          property_id: room.property_id,
          room_id: roomId,
          promo_id: quote.promoId,
          source: BOOKING_SOURCE.APP,
          check_in: checkIn,
          check_out: checkOut,
          guests: dto.guests,
          subtotal: quote.subtotal,
          fee: quote.fee,
          discount: quote.discount,
          total: quote.total,
          // Unpaid until the QR is settled; the payment webhook confirms it.
          status: BOOKING_STATUS.PENDING,
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

      // Counted at booking time, not at payment: a code with 3 uses left must
      // not be handed to four people who are all mid-checkout.
      if (quote.promoId) {
        await tx.promos.update({
          where: { id: quote.promoId },
          data: { used_count: { increment: 1 } },
        });
      }

      await tx.notifications.create({
        data: {
          recipient_type: ACTOR.PARTNER,
          recipient_id: room.properties.partner_id,
          title: 'ມີການຈອງໃໝ່',
          body: `${bookingCode(booking.id)} · ${quote.nights} ຄືນ · ₭${quote.total.toLocaleString('en-US')}`,
          type: 'booking',
        },
      });

      return {
        ...booking,
        code: bookingCode(booking.id),
        property: room.properties.name,
        quote,
      };
    });
  }

  async list(userId: bigint, dto: PaginationDto & { status?: string }) {
    const where = { user_id: userId, ...(dto.status ? { status: dto.status } : {}) };

    const [rows, total] = await Promise.all([
      this.prisma.bookings.findMany({
        where,
        skip: dto.skip,
        take: dto.limit,
        orderBy: { created_at: 'desc' },
        include: {
          properties: { select: { id: true, name: true, province: true, photos: true } },
          rooms: { select: { id: true, name: true } },
          payments: { select: { id: true, status: true, amount: true } },
          reviews: { select: { id: true } },
        },
      }),
      this.prisma.bookings.count({ where }),
    ]);

    return paged(
      rows.map((b) => ({
        id: b.id,
        code: bookingCode(b.id),
        propertyId: b.properties.id,
        property: b.properties.name,
        province: b.properties.province,
        photo: firstPhoto(b.properties.photos),
        room: b.rooms.name,
        checkIn: b.check_in,
        checkOut: b.check_out,
        nights: nightsBetween(b.check_in, b.check_out),
        guests: b.guests,
        subtotal: b.subtotal,
        fee: b.fee,
        discount: b.discount,
        total: b.total,
        status: b.status,
        paymentStatus: b.payments[0]?.status ?? null,
        paymentId: b.payments[0]?.id ?? null,
        reviewed: b.reviews.length > 0,
      })),
      total,
      dto,
    );
  }

  async findOne(userId: bigint, id: bigint) {
    const b = await this.prisma.bookings.findFirst({
      where: { id, user_id: userId },
      include: {
        properties: {
          select: {
            id: true,
            name: true,
            province: true,
            address: true,
            lat: true,
            lng: true,
            photos: true,
            partners: { select: { owner_name: true, phone: true } },
          },
        },
        rooms: { select: { id: true, name: true, room_no: true, bed_type: true, has_ac: true } },
        payments: true,
        cancellations: true,
        booking_items: true,
        reviews: { select: { id: true, stars: true, text: true } },
        promos: { select: { code: true, type: true, value: true } },
      },
    });

    if (!b) throw new NotFoundException(`ບໍ່ພົບການຈອງ #${id} · Booking not found`);

    return { ...b, code: bookingCode(b.id), nights: nightsBetween(b.check_in, b.check_out) };
  }

  /**
   * A review may only be written by the guest who stayed, once, and only after
   * the stay is done. The property's score is recalculated in the same
   * transaction so the two can never disagree.
   */
  async review(userId: bigint, bookingId: bigint, dto: CreateReviewDto) {
    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.bookings.findFirst({
        where: { id: bookingId, user_id: userId },
        include: { reviews: { select: { id: true } } },
      });

      if (!booking) throw new NotFoundException(`ບໍ່ພົບການຈອງ #${bookingId} · Booking not found`);
      if (booking.status !== BOOKING_STATUS.DONE) {
        throw new BadRequestException(
          'ຂຽນຮີວິວໄດ້ຫຼັງພັກຈົບແລ້ວ · You can review a stay once it is complete',
        );
      }
      if (booking.reviews.length) {
        throw new ConflictException('ຮີວິວການຈອງນີ້ແລ້ວ · You have already reviewed this stay');
      }

      const review = await tx.reviews.create({
        data: {
          booking_id: bookingId,
          property_id: booking.property_id,
          stars: dto.stars,
          text: dto.text ?? null,
        },
      });

      await recalcPropertyRating(tx, booking.property_id);

      const property = await tx.properties.findUniqueOrThrow({
        where: { id: booking.property_id },
        select: { partner_id: true, rating: true, review_count: true },
      });

      await tx.notifications.create({
        data: {
          recipient_type: ACTOR.PARTNER,
          recipient_id: property.partner_id,
          title: 'ມີຮີວິວໃໝ່',
          body: `${bookingCode(bookingId)} · ${dto.stars} ດາວ`,
          type: 'review',
        },
      });

      return { review, propertyRating: property.rating, propertyReviewCount: property.review_count };
    });
  }
}

/** `properties.photos` is free-form jsonb; only an array of strings is usable. */
function firstPhoto(photos: unknown): string | null {
  if (!Array.isArray(photos) || !photos.length) return null;
  const first = photos[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && typeof (first as { url?: unknown }).url === 'string') {
    return (first as { url: string }).url;
  }
  return null;
}
