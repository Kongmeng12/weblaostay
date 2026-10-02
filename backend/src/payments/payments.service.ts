import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, booking_status, payment_method, payment_status, refund_status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../common/settings.service';
import { InventoryService } from '../booking/inventory.service';
import { LedgerService } from '../booking/ledger.service';
import { lockBooking } from '../booking/booking-lock';
import { todayInLaos } from '../common/dates';
import { formatKip, kipOf } from '../common/money';
import { NotificationsService } from '../notifications/notifications.service';
import {
  PAYMENT_PROVIDER,
  type CallbackResult,
  type PaymentProvider,
} from './payment-provider.interface';
import {
  CHANNEL_MIN_KIP,
  defaultChannel,
  enabledChannels,
  isChannel,
  type PaymentChannel,
} from './channels';

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
    private readonly config: ConfigService,
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
  async createForBooking(customerId: bigint, bookingId: bigint, requested?: string) {
    if (requested !== undefined && !isChannel(requested)) {
      throw new BadRequestException(`ບໍ່ຮູ້ຈັກຊ່ອງທາງ "${requested}" · Unknown payment channel`);
    }
    const channel: PaymentChannel = requested ?? defaultChannel(this.config);
    if (!enabledChannels(this.config).includes(channel)) {
      throw new BadRequestException('ຊ່ອງທາງນີ້ຍັງບໍ່ເປີດໃຫ້ໃຊ້ · This payment channel is not available');
    }

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

    const min = CHANNEL_MIN_KIP[channel];
    if (min !== undefined && booking.total_amount < BigInt(min)) {
      throw new BadRequestException(
        `ຊ່ອງທາງນີ້ຮັບຢ່າງໜ້ອຍ ${formatKip(min)} · This channel needs at least ${formatKip(min)}`,
      );
    }

    const now = new Date();
    const live = booking.payments.find(
      (p) => p.status === payment_status.pending && (!p.expired_at || p.expired_at > now),
    );
    // A live charge on the same channel is reused rather than replaced: the
    // guest may already have it open in their banking app. Rows from before
    // the guest could choose have no channel and were all `PHAJAY_BANK`.
    if (live && (live.channel ?? defaultChannel(this.config)) === channel) {
      return toPaymentView(live);
    }
    const { qr_ttl_minutes } = await this.settings.get();
    const attempt = booking.payments.length + 1;
    const idempotencyKey = `booking:${bookingId}:${attempt}`;

    const charge = await this.provider.createCharge({
      bookingId,
      channel,
      amountKip: Number(booking.total_amount),
      reference: booking.booking_code,
      description: `PhaPhak ${booking.booking_code} · ${booking.properties.property_name}`,
    });

    try {
      const payment = await this.prisma.payments.create({
        data: {
          booking_id: bookingId,
          idempotency_key: idempotencyKey,
          payment_method: channel === 'card' ? payment_method.phajay_card : payment_method.phajay_qr,
          channel,
          qr_payload: charge.qrPayload,
          redirect_url: charge.deepLink,
          amount: booking.total_amount,
          status: payment_status.pending,
          expired_at: charge.expiresAt ?? new Date(Date.now() + qr_ttl_minutes * 60_000),
          txn_ref: charge.providerRef,
        },
      });
      // A different bank: the old code is retired — only now, once the new
      // one exists, so a gateway failure does not leave the guest with
      // neither. Paying the old one anyway still settles: `settle` matches on
      // the transaction id and does not require `pending`.
      if (live) {
        await this.prisma.payments.updateMany({
          where: { payment_id: live.payment_id, status: payment_status.pending },
          data: { status: payment_status.expired },
        });
      }
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

  /** What the "how would you like to pay" list offers. */
  channels() {
    return {
      defaultChannel: defaultChannel(this.config),
      channels: enabledChannels(this.config).map((id) => ({
        id,
        group: id === 'card' ? 'card' : 'bank',
        minAmount: CHANNEL_MIN_KIP[id] ?? null,
      })),
    };
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
      // The `payment.status === paid` check above reads outside this
      // transaction, so two callbacks arriving close together (a provider
      // webhook retry racing a manual settle, say) can both sail past it
      // before either has written `paid`. This update is the real guard:
      // `status: { not: paid }` only matches while unpaid, and Postgres
      // holds the row lock until commit, so the second transaction's update
      // blocks, then re-checks the condition and matches zero rows.
      const updated = await tx.payments.updateMany({
        where: { payment_id: payment.payment_id, status: { not: payment_status.paid } },
        data: {
          status: payment_status.paid,
          paid_at: new Date(),
          txn_ref: result.txnRef ?? payment.txn_ref,
        },
      });
      if (updated.count === 0) {
        return { accepted: true, duplicate: true, paymentId: payment.payment_id.toString() };
      }

      // Queue behind the hold sweeper and a cancellation before reading the
      // booking's status (see lockBooking): otherwise a hold released a
      // moment ago gets "confirmed" again, and that decrement comes off some
      // other guest's hold.
      await lockBooking(tx, payment.booking_id);

      // The guest can switch bank, which leaves the first QR scannable in a
      // banking app that already opened it. If both get paid, the second must
      // not confirm the stay again — that would book the room twice in
      // inventory and charge the ledger twice. The money is recorded on its
      // payment row; returning it is an operator's job.
      const otherPaid = await tx.payments.count({
        where: {
          booking_id: payment.booking_id,
          status: payment_status.paid,
          payment_id: { not: payment.payment_id },
        },
      });
      if (otherPaid > 0) {
        // Owed back in full, and on the admin Refunds screen rather than only
        // in a log line nobody reads.
        await this.owedInFull(
          tx,
          payment,
          'ຈ່າຍຊ້ຳ ຄືນເງິນຄັ້ງທີສອງເຕັມຈຳນວນ · Paid twice — the second payment is returned in full',
        );
        this.logger.error(
          `Booking ${payment.booking_id} paid twice (payment ${payment.payment_id} is the second) — full refund recorded`,
        );
        return { accepted: true, paid: true, secondPayment: true, refundOwed: true, paymentId: payment.payment_id.toString() };
      }

      const booking = await tx.bookings.findUniqueOrThrow({
        where: { booking_id: payment.booking_id },
        include: {
          booking_items: true,
          properties: { select: { partner_id: true, property_name: true } },
        },
      });

      // Money that arrives after the booking stopped waiting for it:
      //  - the hold ran out (the system cancelled it) and the room is still
      //    free → the guest paid, so they get the stay: take the nights again
      //    through hold(), with its full availability check, and confirm;
      //  - the room went to someone else meanwhile, or a PERSON cancelled the
      //    booking (the guest walked away, the property cancelled) → no stay:
      //    the payment is owed back in full, and none of it is the partner's.
      // It used to stay cancelled AND go into the partner's ledger, with
      // "payment received" sent to both sides and no refund on record.
      let revived = false;
      if (booking.status === booking_status.cancelled) {
        revived = (await this.cancelledByHoldExpiry(tx, booking.booking_id))
          && (await this.retakeNights(tx, booking));

        if (!revived) {
          await this.owedInFull(
            tx,
            payment,
            'ຈ່າຍຫຼັງການຈອງຖືກຍົກເລີກ ຄືນເງິນເຕັມຈຳນວນ · Paid after the booking was cancelled — returned in full',
          );
          await this.notifications.send(tx, {
            userId: booking.customer_id,
            templateCode: 'booking_cancelled',
            vars: { booking_code: booking.booking_code, refund: formatKip(payment.amount) },
            referenceType: 'booking',
            referenceId: booking.booking_id,
          });
          this.logger.error(
            `Payment ${payment.payment_id} arrived for cancelled booking ${booking.booking_id} — full refund recorded`,
          );
          return {
            accepted: true,
            paid: true,
            refundOwed: true,
            paymentId: payment.payment_id.toString(),
            bookingId: booking.booking_id.toString(),
            bookingStatus: booking_status.cancelled,
          };
        }
      } else {
        for (const item of booking.booking_items) {
          await this.inventory.confirmHold(
            tx,
            item.room_type_id,
            booking.check_in,
            booking.check_out,
            item.quantity,
          );
        }
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
          note: revived
            ? 'ຈ່າຍຫຼັງໝົດເວລາ ຫ້ອງຍັງວ່າງ ຢືນຢັນແລ້ວ · Paid after the hold expired; the room was still free'
            : 'ຮັບຊຳລະແລ້ວ · Payment settled',
        },
      });

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
      await this.notifications.sendToAdmins(tx, {
        templateCode: 'admin_booking_paid',
        vars,
        referenceType: 'booking',
        referenceId: booking.booking_id,
      });

      this.logger.log(`Payment ${payment.payment_id} settled for booking ${booking.booking_id}`);

      return {
        accepted: true,
        paid: true,
        paymentId: payment.payment_id.toString(),
        bookingId: booking.booking_id.toString(),
        bookingStatus: booking_status.confirmed,
        ...(revived ? { revived: true } : {}),
      };
    });
  }

  /**
   * Whether the last move into `cancelled` was the hold sweeper's — the only
   * cancellation a late payment may undo. Its log row has no person on it and
   * comes from `pending`; a guest's or partner's cancellation names who did it.
   */
  private async cancelledByHoldExpiry(tx: Prisma.TransactionClient, bookingId: bigint): Promise<boolean> {
    const last = await tx.booking_status_logs.findFirst({
      where: { booking_id: bookingId, to_status: booking_status.cancelled },
      orderBy: { created_at: 'desc' },
      select: { from_status: true, changed_by: true },
    });
    return !!last && last.changed_by === null && last.from_status === booking_status.pending;
  }

  /**
   * Takes an expired booking's nights again and books them, all or nothing.
   * hold() is the same availability check every booking goes through, so a
   * room sold meanwhile is never taken twice. A savepoint undoes a partial
   * take (two of three nights) when a later night is full; the stay must
   * also not have started already.
   */
  private async retakeNights(
    tx: Prisma.TransactionClient,
    booking: { check_in: Date; check_out: Date; booking_items: { room_type_id: bigint; quantity: number }[] },
  ): Promise<boolean> {
    if (booking.check_in < todayInLaos()) return false;

    await tx.$executeRaw`SAVEPOINT retake_nights`;
    try {
      for (const item of booking.booking_items) {
        await this.inventory.hold(tx, item.room_type_id, booking.check_in, booking.check_out, item.quantity);
        await this.inventory.confirmHold(tx, item.room_type_id, booking.check_in, booking.check_out, item.quantity);
      }
      await tx.$executeRaw`RELEASE SAVEPOINT retake_nights`;
      return true;
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err;
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT retake_nights`;
      return false;
    }
  }

  /**
   * Records a payment as owed back in full: a pending refund on the admin
   * Refunds screen (paid back by hand from PhaJay's portal, as every refund
   * is) and the payment marked refunded. No ledger entry: this money was
   * never the partner's.
   */
  private async owedInFull(
    tx: Prisma.TransactionClient,
    payment: { payment_id: bigint; booking_id: bigint; amount: bigint },
    reason: string,
  ): Promise<void> {
    await tx.refunds.create({
      data: {
        payment_id: payment.payment_id,
        booking_id: payment.booking_id,
        amount: payment.amount,
        reason: reason.slice(0, 255),
        status: refund_status.pending,
      },
    });
    await tx.payments.update({
      where: { payment_id: payment.payment_id },
      data: { status: payment_status.refunded },
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
  channel: string | null;
  qr_payload: string | null;
  redirect_url: string | null;
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
    channel: p.channel,
    qrPayload: p.qr_payload,
    // The bank app's deep link or the card page — stored, so a guest who
    // comes back to a live QR still gets the button.
    deepLink: p.redirect_url,
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
