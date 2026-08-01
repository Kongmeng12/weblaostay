import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AVAILABILITY_STATUS,
  BOOKING_STATUS,
  PAYMENT_STATUS,
  bookingCode,
} from '../common/money';
import { ACTOR } from '../common/actors';
import {
  PAYMENT_PROVIDER,
  type CallbackResult,
  type PaymentProvider,
} from './payment-provider.interface';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Get or create the QR for a booking.
   *
   * `idempotency_key` is `booking:<id>` and the column is unique, so pressing
   * "pay" twice — or twice at once on a flaky connection — yields one payment
   * row and one QR, not two charges the guest could both settle.
   */
  async createForBooking(userId: bigint, bookingId: bigint) {
    const booking = await this.prisma.bookings.findFirst({
      where: { id: bookingId, user_id: userId },
      include: {
        payments: true,
        properties: { select: { name: true } },
      },
    });

    if (!booking) throw new NotFoundException(`ບໍ່ພົບການຈອງ #${bookingId} · Booking not found`);
    if (booking.status === BOOKING_STATUS.CANCELLED) {
      throw new BadRequestException('ການຈອງຖືກຍົກເລີກແລ້ວ · This booking was cancelled');
    }

    const paid = booking.payments.find((p) => p.status === PAYMENT_STATUS.PAID);
    if (paid) {
      throw new ConflictException('ຈ່າຍແລ້ວ · This booking is already paid');
    }

    // A live QR is reused rather than replaced: the guest may already have it
    // open in their banking app.
    const existing = booking.payments.find(
      (p) => p.status === PAYMENT_STATUS.PENDING && (!p.expires_at || p.expires_at > new Date()),
    );
    if (existing) return toPaymentView(existing);

    const reference = bookingCode(bookingId);
    const charge = await this.provider.createCharge({
      bookingId,
      amountKip: booking.total,
      reference,
      description: `LaoStay ${reference} · ${booking.properties.name}`,
    });

    const idempotencyKey = `booking:${bookingId}`;

    try {
      const payment = await this.prisma.payments.create({
        data: {
          booking_id: bookingId,
          method: 'phajay_qr',
          idempotency_key: idempotencyKey,
          qr_payload: charge.qrPayload,
          amount: booking.total,
          status: PAYMENT_STATUS.PENDING,
          expires_at: charge.expiresAt,
          txn_ref: charge.providerRef,
        },
      });
      return toPaymentView(payment);
    } catch (err) {
      // Someone else won the race on the unique key — return their row, which
      // is exactly what this caller wanted anyway.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const won = await this.prisma.payments.findUnique({
          where: { idempotency_key: idempotencyKey },
        });
        if (won) return toPaymentView(won);
      }
      throw err;
    }
  }

  /** Status poll for the "waiting for payment" screen. */
  async findOne(userId: bigint, paymentId: bigint) {
    const payment = await this.prisma.payments.findFirst({
      where: { id: paymentId, bookings: { user_id: userId } },
      include: { bookings: { select: { id: true, status: true } } },
    });
    if (!payment) throw new NotFoundException(`ບໍ່ພົບການຊຳລະ #${paymentId} · Payment not found`);

    // An expired QR is reported as expired even if nothing has swept it yet, so
    // the app never shows a dead code as live.
    const expired =
      payment.status === PAYMENT_STATUS.PENDING &&
      payment.expires_at !== null &&
      payment.expires_at <= new Date();

    return {
      ...toPaymentView(payment),
      status: expired ? PAYMENT_STATUS.EXPIRED : payment.status,
      bookingStatus: payment.bookings.status,
    };
  }

  /**
   * Settle a payment from a provider callback.
   *
   * Idempotent twice over: by `txn_ref`, so a provider retrying the same
   * webhook is a no-op, and by the payment's own status, so a late duplicate
   * cannot confirm a booking that has since been cancelled.
   */
  async handleCallback(rawBody: Buffer, headers: Record<string, unknown>) {
    const result = this.provider.verifyCallback(rawBody, headers);
    if (!result.ok) {
      this.logger.warn(`Rejected payment callback: ${result.reason ?? 'unverified'}`);
      return { accepted: false, reason: result.reason ?? 'unverified' };
    }
    return this.settle(result, rawBody);
  }

  /** The verified half of `handleCallback`, also used by the dev settle route. */
  async settle(result: CallbackResult, rawBody: Buffer) {
    const payment = await this.findPaymentFor(result);
    if (!payment) {
      this.logger.warn(
        `Callback for unknown payment (ref=${result.reference}, txn=${result.txnRef})`,
      );
      return { accepted: false, reason: 'unknown payment' };
    }

    if (payment.status === PAYMENT_STATUS.PAID) {
      // Already settled — the provider is retrying. Report success so it stops.
      return { accepted: true, duplicate: true, paymentId: payment.id.toString() };
    }

    if (result.status && result.status !== 'paid') {
      await this.prisma.payments.update({
        where: { id: payment.id },
        data: {
          status: result.status === 'expired' ? PAYMENT_STATUS.EXPIRED : PAYMENT_STATUS.PENDING,
          raw_callback: safeJson(rawBody),
        },
      });
      return { accepted: true, paid: false, status: result.status };
    }

    // The amount the bank captured must be the amount we asked for. A mismatch
    // is either a provider bug or tampering; either way it is not a paid stay.
    if (result.amountKip !== null && result.amountKip !== payment.amount) {
      this.logger.error(
        `Amount mismatch on payment ${payment.id}: expected ${payment.amount}, callback said ${result.amountKip}`,
      );
      return { accepted: false, reason: 'amount mismatch' };
    }

    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.bookings.findUniqueOrThrow({
        where: { id: payment.booking_id },
        include: { properties: { select: { partner_id: true, name: true } } },
      });

      await tx.payments.update({
        where: { id: payment.id },
        data: {
          status: PAYMENT_STATUS.PAID,
          paid_at: new Date(),
          txn_ref: result.txnRef ?? payment.txn_ref,
          raw_callback: safeJson(rawBody),
        },
      });

      // A booking cancelled while the QR was open stays cancelled: the money is
      // recorded, and the refund is the operator's call, not an auto-revival.
      if (booking.status !== BOOKING_STATUS.CANCELLED) {
        await tx.bookings.update({
          where: { id: booking.id },
          data: { status: BOOKING_STATUS.CONFIRMED },
        });

        await tx.room_availability.updateMany({
          where: {
            room_id: booking.room_id,
            date: { gte: booking.check_in, lt: booking.check_out },
            status: AVAILABILITY_STATUS.AVAILABLE,
          },
          data: { status: AVAILABILITY_STATUS.BOOKED },
        });
      }

      await tx.notifications.createMany({
        data: [
          {
            recipient_type: ACTOR.USER,
            recipient_id: booking.user_id,
            title: 'ຊຳລະສຳເລັດ',
            body: `${bookingCode(booking.id)} · ₭${payment.amount.toLocaleString('en-US')} · ${booking.properties.name}`,
            type: 'payment',
          },
          {
            recipient_type: ACTOR.PARTNER,
            recipient_id: booking.properties.partner_id,
            title: 'ໄດ້ຮັບການຊຳລະ',
            body: `${bookingCode(booking.id)} · ₭${payment.amount.toLocaleString('en-US')}`,
            type: 'payment',
          },
        ],
      });

      this.logger.log(`Payment ${payment.id} settled for booking ${booking.id}`);

      return {
        accepted: true,
        paid: true,
        paymentId: payment.id.toString(),
        bookingId: booking.id.toString(),
        bookingStatus:
          booking.status === BOOKING_STATUS.CANCELLED
            ? BOOKING_STATUS.CANCELLED
            : BOOKING_STATUS.CONFIRMED,
      };
    });
  }

  /** Development only: fetch a payment so the dev settle route can sign for it. */
  async requirePayment(paymentId: bigint) {
    const payment = await this.prisma.payments.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException(`ບໍ່ພົບການຊຳລະ #${paymentId} · Payment not found`);
    return payment;
  }

  /**
   * Matches a callback to a payment: by the provider's transaction id when it
   * gave us one at charge time, otherwise by our own booking reference.
   */
  private async findPaymentFor(result: CallbackResult) {
    if (result.txnRef) {
      const byTxn = await this.prisma.payments.findFirst({ where: { txn_ref: result.txnRef } });
      if (byTxn) return byTxn;
    }
    if (!result.reference) return null;

    const bookingId = referenceToBookingId(result.reference);
    if (bookingId === null) return null;

    return this.prisma.payments.findUnique({
      where: { idempotency_key: `booking:${bookingId}` },
    });
  }
}

/** `STL-0142` → 322n. The reference is the booking code we sent to the bank. */
function referenceToBookingId(reference: string): bigint | null {
  const cleaned = reference.trim().toUpperCase().replace(/^STL-/, '');
  if (!/^[0-9A-F]+$/.test(cleaned)) return null;
  try {
    return BigInt('0x' + cleaned);
  } catch {
    return null;
  }
}

function toPaymentView(p: {
  id: bigint;
  booking_id: bigint;
  method: string | null;
  qr_payload: string | null;
  amount: number;
  status: string | null;
  paid_at: Date | null;
  expires_at: Date | null;
  txn_ref: string | null;
}) {
  return {
    id: p.id,
    bookingId: p.booking_id,
    method: p.method,
    qrPayload: p.qr_payload,
    amount: p.amount,
    status: p.status,
    paidAt: p.paid_at,
    expiresAt: p.expires_at,
    txnRef: p.txn_ref,
  };
}

/** Stores the callback verbatim for later investigation; never fails the settle. */
function safeJson(rawBody: Buffer): Prisma.InputJsonValue {
  try {
    return JSON.parse(rawBody.toString('utf8')) as Prisma.InputJsonValue;
  } catch {
    return { raw: rawBody.toString('utf8').slice(0, 4000) };
  }
}
