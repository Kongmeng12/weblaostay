import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { payment_status, refund_status } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BookingService } from '../booking.service';
import { renderConfirmationPdf, type DocStatus } from './confirmation-pdf';
import { buildStayIcs } from './ics';

/** A paid booking has something to confirm; a cancelled one, a refund to show. */
const PDF_STATUSES = new Set<string>(['confirmed', 'staying', 'completed', 'no_show', 'cancelled']);

/** Payments whose money was received, whether or not some went back later. */
const RECEIVED = new Set<string>([
  payment_status.paid,
  payment_status.partially_refunded,
  payment_status.refunded,
]);

/** Only a stay still ahead of (or under way for) the guest belongs in a calendar. */
const ICS_STATUSES = new Set<string>(['confirmed', 'staying']);

export interface DownloadableFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

/**
 * The files a guest can keep on their own device: the booking confirmation
 * (PDF) and the stay as a calendar event (iCalendar).
 *
 * Every read goes through `BookingService.findOne(id, customerId)` — the same
 * call as GET /customer/bookings/:id — so the ownership check (someone else's
 * booking is a 404) and the guest-only view (no commission or payout) come
 * with it rather than being re-implemented here.
 */
@Injectable()
export class BookingDocumentsService {
  constructor(
    private readonly bookings: BookingService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async confirmationPdf(bookingId: bigint, customerId: bigint): Promise<DownloadableFile> {
    const b = await this.bookings.findOne(bookingId, customerId);
    if (!PDF_STATUSES.has(b.status)) {
      throw new ConflictException(
        'ການຈອງນີ້ຍັງບໍ່ໄດ້ຈ່າຍເງິນ ຈຶ່ງຍັງບໍ່ມີໃບຢືນຢັນ · ' +
          'This booking has not been paid yet, so there is no confirmation to download',
      );
    }

    // findOne's payment list leaves the method out; the receipt names it.
    const payment = await this.prisma.payments.findFirst({
      where: { booking_id: bookingId, status: { in: [...RECEIVED] as payment_status[] } },
      orderBy: { paid_at: 'desc' },
      select: { payment_method: true, paid_at: true },
    });

    // A receipt shows what was received and what went back as two lines.
    // `paidAmount` only counts payments still `paid`, so a refunded booking
    // would read as never paid at all.
    const received = b.payments
      .filter((p) => RECEIVED.has(p.status))
      .reduce((sum, p) => sum + Number(p.amount), 0);
    // Only money that has actually gone back — a pending refund is a promise.
    const refunded = b.refunds
      .filter((r) => r.status === refund_status.completed)
      .reduce((sum, r) => sum + Number(r.amount), 0);

    const body = await renderConfirmationPdf({
      code: b.code,
      status: b.status as DocStatus,
      issuedAt: new Date(),
      guestName: b.guest.name,
      guestPhone: b.guest.phone,
      propertyName: b.property.name,
      address: joinAddress(b.property.address, b.property.district, b.property.province),
      propertyPhone: b.property.phone,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      nights: b.nights,
      roomName: b.roomType?.name ?? null,
      roomQuantity: b.roomType?.quantity ?? 1,
      roomNumbers: b.roomType?.roomNumbers ?? [],
      guests: b.guests,
      specialRequest: b.specialRequest?.trim() || null,
      subtotal: Number(b.subtotal),
      serviceFee: Number(b.serviceFee),
      tax: Number(b.tax),
      cleaningFee: Number(b.cleaningFee),
      discount: Number(b.discount),
      total: Number(b.total),
      paid: received,
      refunded,
      payment: payment ? { method: payment.payment_method, paidAt: payment.paid_at } : null,
      cancellation: b.cancellation
        ? {
            reason: b.cancellation.reason?.trim() || null,
            penalty: Number(b.cancellation.penalty),
            refund: Number(b.cancellation.refund),
            cancelledAt: b.cancellation.cancelledAt,
          }
        : null,
      policy: b.cancellationPolicy
        ? {
            daysBeforeCheckin: b.cancellationPolicy.daysBeforeCheckin,
            penaltyPercent: Number(b.cancellationPolicy.penaltyPercent),
            isRefundable: b.cancellationPolicy.isRefundable,
          }
        : null,
      url: this.tripUrl(b.id),
    });

    return { filename: `PhaPhak-${safeCode(b.code)}.pdf`, contentType: 'application/pdf', body };
  }

  async calendarIcs(bookingId: bigint, customerId: bigint): Promise<DownloadableFile> {
    const b = await this.bookings.findOne(bookingId, customerId);
    if (!ICS_STATUSES.has(b.status)) {
      throw new ConflictException(
        'ເພີ່ມໃສ່ປະຕິທິນໄດ້ສະເພາະການຈອງທີ່ຢືນຢັນແລ້ວ ແລະ ຍັງບໍ່ສິ້ນສຸດ · ' +
          'Only a confirmed, upcoming stay can be added to a calendar',
      );
    }

    const text = buildStayIcs({
      bookingId: b.id,
      code: b.code,
      propertyName: b.property.name,
      address: joinAddress(b.property.address, b.property.district, b.property.province),
      lat: b.property.lat,
      lng: b.property.lng,
      phone: b.property.phone,
      roomName: b.roomType?.name ?? null,
      guests: b.guests,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      url: this.tripUrl(b.id),
    });

    return {
      filename: `PhaPhak-${safeCode(b.code)}.ics`,
      contentType: 'text/calendar; charset=utf-8',
      body: Buffer.from(text, 'utf8'),
    };
  }

  /**
   * The guest's trip page. `CORS_ORIGIN`'s first entry is the customer site —
   * the same source the password-reset link uses (see AuthService.appUrl).
   */
  private tripUrl(bookingId: string): string {
    const first = (this.config.get<string>('CORS_ORIGIN') ?? '').split(',')[0]?.trim();
    const base = (first || 'https://phaphak.com').replace(/\/+$/, '');
    return `${base}/trips/${bookingId}`;
  }
}

/** Written address, then district and province — blanks and repeats dropped. */
function joinAddress(...parts: (string | null | undefined)[]): string | null {
  const kept = [...new Set(parts.map((p) => p?.trim()).filter((p): p is string => !!p))];
  return kept.length ? kept.join(', ') : null;
}

/** A filename is attacker-adjacent input to the OS; keep it to a safe alphabet. */
function safeCode(code: string): string {
  return code.replace(/[^A-Za-z0-9-]/g, '') || 'booking';
}
