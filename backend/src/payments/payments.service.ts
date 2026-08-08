import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, booking_status, payment_status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../common/settings.service';
import { InventoryService } from '../booking/inventory.service';
import { LedgerService } from '../booking/ledger.service';
import { formatKip, kipOf } from '../common/money';
import { NotificationsService } from '../notifications/notifications.service';
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
    private readonly settings: SettingsService,
    private readonly inventory: InventoryService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Issues the QR for a booking, or returns the live one.
   *
   * `idempotency_key` is `booking:<id>:<attempt>` and the column is unique, so
   * pressing "pay" twice — or twice at once on a flaky connection — cannot
   * produce two live charges for the same stay. A QR that has expired does get
   * a fresh attempt, which is why the key carries an attempt number rather than
   * being the booking alone.
   */
  async createForBooking(customerId: bigint, bookingId: bigint) {
    const booking = await this.prisma.bookings.findFirst({
      where: { booking_id: bookingId, customer_id: customerId, deleted_at: null },
      include: { payments: true, properties: { select: { property_name: true } } },
    });

    if (!booking) throw new NotFoundException(`ບໍ່ພົບການຈອງ #${bookingId} · Booking not found`);
    if (booking.status === booking_status.cancelled) {
      throw new BadRequestException('ການຈອງຖືກຍົກເລີກແລ້ວ · This booking was cancelled');
    }
    if (booking.payments.some((p) => p.status === payment_status.paid)) {
      throw new ConflictException('ຈ່າຍແລ້ວ · This booking is already paid');
    }

    const now = new Date();
    // A live QR is reused rather than replaced: the guest may already have it
    // open in their banking app.
    const live = booking.payments.find(
      (p) => p.status === payment_status.pending && (!p.expired_at || p.expired_at > now),
    );
    if (live) return toPaymentView(live);

    const { qr_ttl_minutes } = await this.settings.get();
    const attempt = booking.payments.length + 1;
    const idempotencyKey = `booking:${bookingId}:${attempt}`;

    const charge = await this.provider.createCharge({
      bookingId,
      amountKip: Number(booking.total_amount),
      reference: booking.booking_code,
      description: `LaoStay ${booking.booking_code} · ${booking.properties.property_name}`,
    });

    try {
      const payment = await this.prisma.payments.create({
        data: {
          booking_id: bookingId,
          idempotency_key: idempotencyKey,
          qr_payload: charge.qrPayload,
          amount: booking.total_amount,
          status: payment_status.pending,
          expired_at: charge.expiresAt ?? new Date(Date.now() + qr_ttl_minutes * 60_000),
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
  async findOne(customerId: bigint, paymentId: bigint) {
    const payment = await this.prisma.payments.findFirst({
      where: { payment_id: paymentId, bookings: { customer_id: customerId } },
      include: { bookings: { select: { booking_id: true, status: true } } },
    });
    if (!payment) throw new NotFoundException(`ບໍ່ພົບການຊຳລະ #${paymentId} · Payment not found`);

    // An expired QR reports as expired even before anything sweeps it, so the
    // app never shows a dead code as live.
    const expired =
      payment.status === payment_status.pending &&
      payment.expired_at !== null &&
      payment.expired_at <= new Date();

    return {
      ...toPaymentView(payment),
      status: expired ? payment_status.expired : payment.status,
      bookingId: payment.bookings.booking_id.toString(),
      bookingStatus: payment.bookings.status,
    };
  }

  /**
   * Settles a payment from a provider callback.
   *
   * Idempotent twice over: the raw callback is always recorded, and a payment
   * already `paid` short-circuits — a provider retrying the same webhook must
   * not confirm the booking twice or double the ledger.
   */
  async handleCallback(rawBody: Buffer, headers: Record<string, unknown>) {
    const result = this.provider.verifyCallback(rawBody, headers);
    if (!result.ok) {
      this.logger.warn(`Rejected payment callback: ${result.reason ?? 'unverified'}`);
      return { accepted: false, reason: result.reason ?? 'unverified' };
    }
    return this.settle(result, rawBody);
  }

  async settle(result: CallbackResult, rawBody: Buffer) {
    const payment = await this.findPaymentFor(result);
    if (!payment) {
      this.logger.warn(
        `Callback for unknown payment (ref=${result.reference}, txn=${result.txnRef})`,
      );
      return { accepted: false, reason: 'unknown payment' };
    }

    // The audit trail is written whatever happens next — a callback that is
    // rejected below is exactly the one someone will want to read later.
    await this.prisma.payment_events.create({
      data: {
        payment_id: payment.payment_id,
        event_type: result.status ?? 'unknown',
        provider_ref: result.txnRef,
        raw_payload: safeJson(rawBody),
      },
    });

    if (payment.status === payment_status.paid) {
      return { accepted: true, duplicate: true, paymentId: payment.payment_id.toString() };
    }

    if (result.status && result.status !== 'paid') {
      await this.prisma.payments.update({
        where: { payment_id: payment.payment_id },
        data: {
          status: result.status === 'expired' ? payment_status.expired : payment_status.failed,
        },
      });
      return { accepted: true, paid: false, status: result.status };
    }

    // The amount the bank captured must be the amount we asked for. A mismatch
    // is a provider bug or tampering; either way it is not a paid stay.
    if (result.amountKip !== null && BigInt(result.amountKip) !== payment.amount) {
      this.logger.error(
        `Amount mismatch on payment ${payment.payment_id}: expected ${payment.amount}, callback said ${result.amountKip}`,
      );
      return { accepted: false, reason: 'amount mismatch' };
    }

    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.bookings.findUniqueOrThrow({
        where: { booking_id: payment.booking_id },
        include: {
          booking_items: true,
          properties: { select: { partner_id: true, property_name: true } },
        },
      });

      await tx.payments.update({
        where: { payment_id: payment.payment_id },
        data: {
          status: payment_status.paid,
          paid_at: new Date(),
          txn_ref: result.txnRef ?? payment.txn_ref,
        },
      });

      // A booking cancelled while the QR was open stays cancelled: the money is
      // recorded, and the refund is an operator decision, not an auto-revival.
      if (booking.status !== booking_status.cancelled) {
        for (const item of booking.booking_items) {
          await this.inventory.confirmHold(
            tx,
            item.room_type_id,
            booking.check_in,
            booking.check_out,
            item.quantity,
          );
        }

        await tx.bookings.update({
          where: { booking_id: booking.booking_id },
          data: { status: booking_status.confirmed, hold_expires_at: null },
        });

        await tx.booking_status_logs.create({
          data: {
            booking_id: booking.booking_id,
            from_status: booking.status,
            to_status: booking_status.confirmed,
            changed_by: null,
            note: 'ຮັບຊຳລະແລ້ວ · Payment settled',
          },
        });
      }

      await this.ledger.recordCharge(tx, {
        bookingId: booking.booking_id,
        partnerId: booking.properties.partner_id,
        paymentId: payment.payment_id,
        amount: payment.amount,
        commission: booking.commission_amount,
      });

      const partnerUser = await tx.partners.findUniqueOrThrow({
        where: { partner_id: booking.properties.partner_id },
        select: { user_id: true },
      });

      // Both sides hear about it, with wording that fits each: the guest paid,
      // the host was paid.
      const vars = {
        booking_code: booking.booking_code,
        amount: formatKip(payment.amount),
        property: booking.properties.property_name,
      };
      await this.notifications.sendMany(tx, [
        {
          userId: booking.customer_id,
          templateCode: 'payment_received',
          vars,
          referenceType: 'booking',
          referenceId: booking.booking_id,
        },
        {
          userId: partnerUser.user_id,
          templateCode: 'payment_received_partner',
          vars,
          referenceType: 'booking',
          referenceId: booking.booking_id,
        },
      ]);

      this.logger.log(`Payment ${payment.payment_id} settled for booking ${booking.booking_id}`);

      return {
        accepted: true,
        paid: true,
        paymentId: payment.payment_id.toString(),
        bookingId: booking.booking_id.toString(),
        bookingStatus:
          booking.status === booking_status.cancelled
            ? booking_status.cancelled
            : booking_status.confirmed,
      };
    });
  }

  /** Development only: fetch a payment so the dev settle route can sign for it. */
  async requirePayment(paymentId: bigint) {
    const payment = await this.prisma.payments.findUnique({
      where: { payment_id: paymentId },
      include: { bookings: { select: { booking_code: true } } },
    });
    if (!payment) throw new NotFoundException(`ບໍ່ພົບການຊຳລະ #${paymentId} · Payment not found`);
    return payment;
  }

  /**
   * Matches a callback to a payment: by the provider's transaction id when it
   * gave us one, otherwise by the booking code we sent as the reference.
   */
  private async findPaymentFor(result: CallbackResult) {
    if (result.txnRef) {
      const byTxn = await this.prisma.payments.findFirst({
        where: { txn_ref: result.txnRef },
        orderBy: { created_at: 'desc' },
      });
      if (byTxn) return byTxn;
    }
    if (!result.reference) return null;

    return this.prisma.payments.findFirst({
      where: { bookings: { booking_code: result.reference } },
      orderBy: { created_at: 'desc' },
    });
  }
}

function toPaymentView(p: {
  payment_id: bigint;
  booking_id: bigint;
  payment_method: string;
  qr_payload: string | null;
  amount: bigint;
  status: payment_status;
  paid_at: Date | null;
  expired_at: Date | null;
  txn_ref: string | null;
}) {
  return {
    id: p.payment_id.toString(),
    bookingId: p.booking_id.toString(),
    method: p.payment_method,
    qrPayload: p.qr_payload,
    amount: kipOf(p.amount),
    status: p.status,
    paidAt: p.paid_at,
    expiresAt: p.expired_at,
    txnRef: p.txn_ref,
  };
}

/** Stores the callback verbatim for later investigation; never fails a settle. */
function safeJson(rawBody: Buffer): Prisma.InputJsonValue {
  try {
    return JSON.parse(rawBody.toString('utf8')) as Prisma.InputJsonValue;
  } catch {
    return { raw: rawBody.toString('utf8').slice(0, 4000) };
  }
}
