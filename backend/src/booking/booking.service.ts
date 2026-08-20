import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  booking_source,
  booking_status,
  payment_status,
  refund_status,
  user_role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../common/settings.service';
import { InventoryService } from './inventory.service';
import { PricingService } from './pricing.service';
import { LedgerService } from './ledger.service';
import { BOOKING_TRANSITIONS } from '../common/enums';
import { bookingCode, cancellationSplit, formatKip, kipOf, rateOf } from '../common/money';
import { NotificationsService } from '../notifications/notifications.service';
import { utcMidnight } from '../common/dates';
import type { CreateBookingDto, WalkInDto } from './booking.dto';

/**
 * Creating, moving and cancelling a booking.
 *
 * Every write here happens inside one transaction, because a half-written
 * booking is worse than none: a `bookings` row whose nights were never held is
 * sold twice, and nights held with no booking row are unsellable forever.
 */
@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly inventory: InventoryService,
    private readonly pricing: PricingService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Prices a stay without touching anything — the checkout summary. */
  async quote(dto: CreateBookingDto) {
    const quote = await this.pricing.quote(this.prisma, {
      roomTypeId: BigInt(dto.roomTypeId),
      checkIn: utcMidnight(dto.checkIn),
      checkOut: utcMidnight(dto.checkOut),
      guests: dto.guests,
      quantity: dto.quantity,
    });
    return this.pricing.toView(quote);
  }

  /**
   * Creates a booking and holds the nights.
   *
   * The booking starts `pending` with a `hold_expires_at`. Inventory moves into
   * `held_count`, not `booked_count` — the guest has not paid yet, and a guest
   * who closes the app must not keep the room off sale forever. The sweeper
   * (HoldSweeper) reclaims it.
   *
   * **The transaction is kept deliberately short.** From the moment `hold()`
   * runs, every other guest booking that room for those nights is queued behind
   * this transaction's row locks, and each statement inside is another Neon
   * round-trip they all wait for. So the pricing, the policy, the guest's name
   * and the booking id are all fetched *before* the transaction opens, and the
   * host's notification is sent *after* it commits. What remains between the
   * lock and the COMMIT is only what has to be atomic with the inventory.
   */
  async create(customerId: bigint, dto: CreateBookingDto) {
    const settings = await this.settings.get();
    const roomTypeId = BigInt(dto.roomTypeId);
    const checkIn = utcMidnight(dto.checkIn);
    const checkOut = utcMidnight(dto.checkOut);
    const quantity = dto.quantity ?? 1;

    // Idempotency is checked before the transaction so a retried request
    // returns the original booking instead of racing for the unique index.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.bookings.findUnique({
        where: { idempotency_key: dto.idempotencyKey },
      });
      if (existing) return this.findOne(existing.booking_id, customerId);
    }

    const quote = await this.pricing.quote(this.prisma, {
      roomTypeId,
      checkIn,
      checkOut,
      guests: dto.guests,
      quantity,
      source: booking_source.app,
    });

    // Independent reads, so they go out together rather than one after another.
    // The booking code is derived from the id, which is why the id is drawn
    // from the sequence here: one INSERT carries both, and no row is ever
    // visible with a code that is not its real one.
    const [bookingId, policyId, profile, hostUserId] = await Promise.all([
      nextBookingId(this.prisma),
      policyIdFor(this.prisma, quote.propertyId),
      this.prisma.user_profiles.findUnique({
        where: { user_id: customerId },
        select: { full_name: true },
      }),
      partnerUserId(this.prisma, quote.partnerId),
    ]);

    const booking = await this.prisma.$transaction(async (tx) => {
      // A booking that cannot get the lock in a few seconds is behind a queue
      // no guest will wait out. Failing here raises 55P03, which `create` turns
      // into a 409 — an honest "try again" instead of a 500 twenty seconds on.
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);

      await this.inventory.hold(tx, roomTypeId, checkIn, checkOut, quantity);

      const created = await tx.bookings.create({
        data: {
          booking_id: bookingId,
          booking_code: bookingCode(bookingId),
          customer_id: customerId,
          property_id: quote.propertyId,
          cancellation_policy_id: policyId,
          source: booking_source.app,
          check_in: checkIn,
          check_out: checkOut,
          nights: quote.nights,
          total_guests: dto.guests,
          subtotal_amount: quote.subtotalAmount,
          discount_amount: quote.discountAmount,
          tax_amount: quote.taxAmount,
          service_fee: quote.serviceFee,
          cleaning_fee: quote.cleaningFee,
          commission_rate: new Prisma.Decimal(quote.commissionRate),
          commission_amount: quote.commissionAmount,
          total_amount: quote.totalAmount,
          payout_amount: quote.payoutAmount,
          status: booking_status.pending,
          hold_expires_at: new Date(Date.now() + settings.hold_ttl_minutes * 60_000),
          special_request: dto.specialRequest ?? null,
          idempotency_key: dto.idempotencyKey ?? null,
        },
      });

      // The line item, the guest and the opening status log in one round-trip.
      // Three separate inserts read better, but they would be three more waits
      // with the room locked; the CTE form keeps the queue moving.
      await tx.$executeRaw`
        WITH item AS (
          INSERT INTO booking_items
            (booking_id, room_type_id, quantity, nights, price_per_night, subtotal)
          VALUES (${bookingId}, ${roomTypeId}, ${quantity}, ${quote.nights},
                  ${quote.perNight[0].price}, ${quote.subtotalAmount})
        ),
        guest AS (
          INSERT INTO booking_guests (booking_id, full_name, is_primary)
          VALUES (${bookingId}, ${profile?.full_name ?? 'Guest'}, true)
        )
        INSERT INTO booking_status_logs (booking_id, from_status, to_status, changed_by, note)
        VALUES (${bookingId}, NULL, 'pending'::booking_status, ${customerId},
                'ສ້າງການຈອງ ແລະ ຈອງຫ້ອງໄວ້ຊົ່ວຄາວ')
      `;

      return created;
    });

    // No transaction on purpose: telling the host is a side effect of the
    // booking, not part of it. A notification that fails must not undo a room
    // the guest has already been told is theirs — `send(null, …)` swallows and
    // logs rather than throwing.
    await this.notifications.send(null, {
      userId: hostUserId,
      templateCode: 'booking_created',
      vars: {
        booking_code: bookingCode(booking.booking_id),
        nights: quote.nights,
        total: formatKip(quote.totalAmount),
      },
      referenceType: 'booking',
      referenceId: booking.booking_id,
    });

    return this.findOne(booking.booking_id, customerId);
  }

  /**
   * A guest who walked in and paid at the desk.
   *
   * Goes straight to `confirmed` and straight into `booked_count`: they are
   * already in the room, so there is nothing to hold and nothing to expire.
   */
  async createWalkIn(partnerId: bigint, dto: WalkInDto) {
    const roomTypeId = BigInt(dto.roomTypeId);
    const checkIn = utcMidnight(dto.checkIn);
    const checkOut = utcMidnight(dto.checkOut);
    const quantity = dto.quantity ?? 1;

    return this.prisma.$transaction(async (tx) => {
      const quote = await this.pricing.quote(tx, {
        roomTypeId,
        checkIn,
        checkOut,
        guests: dto.guests,
        quantity,
        source: booking_source.walk_in,
      });

      if (quote.partnerId !== partnerId) {
        throw new NotFoundException(`ບໍ່ພົບປະເພດຫ້ອງ #${roomTypeId} · Room type not found`);
      }

      await this.inventory.bookDirect(tx, roomTypeId, checkIn, checkOut, quantity);

      const guest = await this.findOrCreateWalkInGuest(tx, dto);
      const bookingId = await nextBookingId(tx);

      const booking = await tx.bookings.create({
        data: {
          booking_id: bookingId,
          booking_code: bookingCode(bookingId),
          customer_id: guest.user_id,
          property_id: quote.propertyId,
          source: booking_source.walk_in,
          check_in: checkIn,
          check_out: checkOut,
          nights: quote.nights,
          total_guests: dto.guests,
          subtotal_amount: quote.subtotalAmount,
          tax_amount: quote.taxAmount,
          service_fee: quote.serviceFee,
          commission_rate: new Prisma.Decimal(quote.commissionRate),
          commission_amount: quote.commissionAmount,
          total_amount: quote.totalAmount,
          payout_amount: quote.payoutAmount,
          // Money changed hands at the desk.
          status: booking_status.confirmed,
        },
      });

      await tx.booking_items.create({
        data: {
          booking_id: bookingId,
          room_type_id: roomTypeId,
          quantity,
          nights: quote.nights,
          price_per_night: quote.perNight[0].price,
          subtotal: quote.subtotalAmount,
        },
      });

      await tx.booking_guests.create({
        data: { booking_id: bookingId, full_name: dto.guestName, is_primary: true },
      });

      await tx.booking_status_logs.create({
        data: {
          booking_id: bookingId,
          to_status: booking_status.confirmed,
          note: 'ບັນທຶກ walk-in ທີ່ເຄົາເຕີ',
        },
      });

      // A walk-in is money the partner already holds, so the ledger records the
      // charge and the commission owed on it, with no payment row involved.
      await this.ledger.recordCharge(tx, {
        bookingId,
        partnerId: quote.partnerId,
        paymentId: bookingId,
        amount: quote.totalAmount,
        commission: quote.commissionAmount,
      });

      return {
        ...toBookingView(booking),
        guest: { id: guest.user_id.toString(), fullName: dto.guestName, phone: dto.guestPhone },
      };
    });
  }

  // ── reading ───────────────────────────────────────────────────────────────

  async findOne(bookingId: bigint, customerId?: bigint) {
    const booking = await this.prisma.bookings.findFirst({
      where: {
        booking_id: bookingId,
        deleted_at: null,
        ...(customerId ? { customer_id: customerId } : {}),
      },
      include: {
        properties: {
          include: {
            provinces: true,
            districts: true,
            partners: { select: { partner_id: true, business_name: true, contact_phone: true } },
            property_images: {
              select: { image_url: true },
              orderBy: [{ is_cover: 'desc' }, { display_order: 'asc' }],
              take: 1,
            },
          },
        },
        booking_items: { include: { room_types: true } },
        booking_guests: true,
        payments: { orderBy: { created_at: 'desc' } },
        refunds: true,
        booking_cancellations: true,
        reviews: true,
        cancellation_policies: true,
        users: { include: { user_profiles: true } },
      },
    });

    if (!booking) throw new NotFoundException(`ບໍ່ພົບການຈອງ #${bookingId} · Booking not found`);

    const item = booking.booking_items[0];
    const paid = booking.payments
      .filter((p) => p.status === payment_status.paid)
      .reduce((sum, p) => sum + p.amount, 0n);

    return {
      ...toBookingView(booking),
      property: {
        id: booking.properties.property_id.toString(),
        name: booking.properties.property_name,
        province: booking.properties.provinces?.province_name_lo ?? null,
        district: booking.properties.districts?.district_name_lo ?? null,
        address: booking.properties.address_detail,
        // A guest holding a confirmed booking is the person most likely to
        // need directions, so the trip screen gets the pin as well as the
        // written address. Decimal has to be stringified before Number or the
        // precision the column was chosen for is lost.
        lat: booking.properties.latitude ? Number(booking.properties.latitude.toString()) : null,
        lng: booking.properties.longitude ? Number(booking.properties.longitude.toString()) : null,
        phone: booking.properties.phone,
        host: booking.properties.partners.business_name,
        photo: booking.properties.property_images[0]?.image_url ?? null,
      },
      roomType: item
        ? {
            id: item.room_type_id.toString(),
            name: item.room_types.type_name,
            quantity: item.quantity,
            pricePerNight: kipOf(item.price_per_night),
          }
        : null,
      guest: {
        name: booking.users.user_profiles?.full_name ?? null,
        email: booking.users.email,
        phone: booking.users.phone,
      },
      guests: booking.booking_guests.map((g) => ({
        name: g.full_name,
        type: g.guest_type,
        isPrimary: g.is_primary,
      })),
      payments: booking.payments.map((p) => ({
        id: p.payment_id.toString(),
        status: p.status,
        amount: kipOf(p.amount),
        paidAt: p.paid_at,
        expiresAt: p.expired_at,
      })),
      paidAmount: kipOf(paid),
      refunds: booking.refunds.map((r) => ({
        id: r.refund_id.toString(),
        amount: kipOf(r.amount),
        status: r.status,
        reason: r.reason,
        refundedAt: r.refunded_at,
      })),
      cancellation: booking.booking_cancellations
        ? {
            reason: booking.booking_cancellations.reason,
            penalty: kipOf(booking.booking_cancellations.penalty_amount),
            refund: kipOf(booking.booking_cancellations.refund_amount),
            cancelledAt: booking.booking_cancellations.cancelled_at,
          }
        : null,
      cancellationPolicy: booking.cancellation_policies
        ? {
            name: booking.cancellation_policies.policy_name,
            daysBeforeCheckin: booking.cancellation_policies.days_before_checkin,
            penaltyPercent: rateOf(booking.cancellation_policies.penalty_percent),
            isRefundable: booking.cancellation_policies.is_refundable,
          }
        : null,
      review: booking.reviews
        ? { id: booking.reviews.review_id.toString(), stars: rateOf(booking.reviews.overall_rating) }
        : null,
      nextStatus: BOOKING_TRANSITIONS[booking.status] ?? [],
    };
  }

  // ── status ────────────────────────────────────────────────────────────────

  /**
   * Moves a booking along the one-way ladder. Cancellation is deliberately not
   * reachable from here — it moves money, so it has its own path.
   */
  async setStatus(bookingId: bigint, to: booking_status, actorId: bigint | null) {
    const booking = await this.prisma.bookings.findUnique({ where: { booking_id: bookingId } });
    if (!booking) throw new NotFoundException(`ບໍ່ພົບການຈອງ #${bookingId} · Booking not found`);

    const allowed = BOOKING_TRANSITIONS[booking.status] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `ປ່ຽນຈາກ "${booking.status}" ໄປ "${to}" ບໍ່ໄດ້ · Cannot move a booking from "${booking.status}" to "${to}"` +
          (allowed.length ? ` (allowed: ${allowed.join(', ')})` : ''),
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.bookings.update({
        where: { booking_id: bookingId },
        data: { status: to },
      });
      await tx.booking_status_logs.create({
        data: {
          booking_id: bookingId,
          from_status: booking.status,
          to_status: to,
          changed_by: actorId,
        },
      });
      return toBookingView(updated);
    });
  }

  // ── cancellation ──────────────────────────────────────────────────────────

  /**
   * Cancels and refunds, as one transaction.
   *
   * Four things must agree afterwards or the books are wrong: the booking is
   * cancelled, the cancellation row records penalty against refund, a refund
   * row exists for money actually captured, and the nights are back on sale.
   */
  async cancel(bookingId: bigint, reason: string | undefined, actor: { id: bigint; role: user_role }) {
    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.bookings.findUnique({
        where: { booking_id: bookingId },
        include: {
          payments: true,
          booking_items: true,
          cancellation_policies: true,
          properties: { select: { partner_id: true } },
        },
      });

      if (!booking) throw new NotFoundException(`ບໍ່ພົບການຈອງ #${bookingId} · Booking not found`);
      if (booking.status === booking_status.cancelled) {
        throw new BadRequestException('ຍົກເລີກໄປແລ້ວ · Booking is already cancelled');
      }
      if (booking.status === booking_status.completed) {
        throw new BadRequestException(
          'ພັກຈົບແລ້ວ ຍົກເລີກບໍ່ໄດ້ · A completed stay cannot be cancelled',
        );
      }
      // Once the guest has checked in, only the property can settle up.
      if (actor.role === user_role.CUSTOMER && booking.status === booking_status.staying) {
        throw new BadRequestException(
          'ເຂົ້າພັກແລ້ວ ຍົກເລີກເອງບໍ່ໄດ້ · Contact the property once you have checked in',
        );
      }

      const item = booking.booking_items[0];
      const quantity = item?.quantity ?? 1;

      // Refund what was actually captured, not the booking total — an unpaid
      // booking refunds nothing.
      const paidPayments = booking.payments.filter((p) => p.status === payment_status.paid);
      const paid = paidPayments.reduce((sum, p) => sum + p.amount, 0n);

      const policy = booking.cancellation_policies;

      // `days_before_checkin` was captured on every seeded policy but never
      // actually checked against the clock — every cancellation got the
      // policy's flat `penalty_percent` regardless of timing, so "cancel
      // before day X for a full refund" was true only by coincidence. This is
      // the enforcement those policies were always supposed to have: once
      // fewer than `days_before_checkin * 24` hours remain before check-in,
      // the cancellation itself is refused, not just charged a bigger
      // penalty. `is_refundable: false` policies are a separate, simpler
      // promise — cancel any time, always at 100% penalty — so they skip
      // this cutoff entirely.
      const cutoffHours = (policy?.days_before_checkin ?? 0) * 24;
      const hoursUntilCheckIn = (booking.check_in.getTime() - Date.now()) / 3_600_000;
      if (policy?.is_refundable !== false && hoursUntilCheckIn < cutoffHours) {
        throw new BadRequestException(
          `ຫຼັງ ${cutoffHours} ຊົ່ວໂມງ ກ່ອນເຂົ້າພັກ ຍົກເລີກບໍ່ໄດ້ · ` +
            `Cancellation is not possible within ${cutoffHours} hours of check-in`,
        );
      }

      const penaltyPercent = policy?.is_refundable === false ? 100 : rateOf(policy?.penalty_percent);
      const { penalty, refund } = cancellationSplit(paid, penaltyPercent);

      await tx.bookings.update({
        where: { booking_id: bookingId },
        data: { status: booking_status.cancelled, hold_expires_at: null },
      });

      await tx.booking_status_logs.create({
        data: {
          booking_id: bookingId,
          from_status: booking.status,
          to_status: booking_status.cancelled,
          changed_by: actor.id,
          note: reason?.slice(0, 500),
        },
      });

      // Which counter to give back depends on whether the guest had paid.
      if (item) {
        if (booking.status === booking_status.pending) {
          await this.inventory.releaseHold(
            tx, item.room_type_id, booking.check_in, booking.check_out, quantity,
          );
        } else {
          await this.inventory.releaseBooked(
            tx, item.room_type_id, booking.check_in, booking.check_out, quantity,
          );
        }
      }

      let refundRow: { refund_id: bigint } | null = null;
      if (refund > 0n && paidPayments.length) {
        refundRow = await tx.refunds.create({
          data: {
            payment_id: paidPayments[0].payment_id,
            booking_id: bookingId,
            amount: refund,
            reason: reason?.slice(0, 255) ?? defaultReason(actor.role),
            // Owed, not sent. PhaJay's refund API returns a charge in full and
            // takes no amount, and a cancellation policy almost always keeps a
            // percentage — so the money goes back by hand, from their portal.
            // `completed` is set on the admin Refunds screen once it has.
            status: refund_status.pending,
            processed_by: actor.id,
          },
          select: { refund_id: true },
        });

        await tx.payments.updateMany({
          where: { booking_id: bookingId, status: payment_status.paid },
          data: {
            status: refund === paid ? payment_status.refunded : payment_status.partially_refunded,
          },
        });

        await this.ledger.recordRefund(tx, {
          bookingId,
          partnerId: booking.properties.partner_id,
          refundId: refundRow.refund_id,
          amount: refund,
        });
      }

      await tx.booking_cancellations.create({
        data: {
          booking_id: bookingId,
          cancelled_by: actor.id,
          reason: reason?.slice(0, 255) ?? defaultReason(actor.role),
          policy_snapshot: policy
            ? {
                policy_name: policy.policy_name,
                days_before_checkin: policy.days_before_checkin,
                penalty_percent: penaltyPercent,
                is_refundable: policy.is_refundable,
              }
            : Prisma.JsonNull,
          penalty_amount: penalty,
          refund_amount: refund,
          refund_id: refundRow?.refund_id ?? null,
        },
      });

      // Inside the transaction: a cancellation notice for a cancellation that
      // rolled back would be worse than none.
      await this.notifications.send(tx, {
        userId: booking.customer_id,
        templateCode: 'booking_cancelled',
        vars: { booking_code: booking.booking_code, refund: formatKip(refund) },
        referenceType: 'booking',
        referenceId: bookingId,
      });

      return {
        bookingId: bookingId.toString(),
        status: booking_status.cancelled,
        paid: kipOf(paid),
        penalty: kipOf(penalty),
        refund: kipOf(refund),
      };
    });
  }

  /**
   * Walk-in guests rarely have an account. Match on phone first — the same
   * person returning should not become a second customer — then create with a
   * placeholder email and an unusable password, so the row cannot be signed
   * into until they register properly.
   */
  private async findOrCreateWalkInGuest(tx: Prisma.TransactionClient, dto: WalkInDto) {
    const existing = await tx.users.findFirst({
      where: dto.guestEmail
        ? { OR: [{ phone: dto.guestPhone }, { email: dto.guestEmail.toLowerCase() }] }
        : { phone: dto.guestPhone },
    });
    if (existing) return existing;

    return tx.users.create({
      data: {
        role: user_role.CUSTOMER,
        email: dto.guestEmail?.toLowerCase() ?? `walkin+${crypto.randomUUID()}@laostay.la`,
        phone: dto.guestPhone,
        // Not a valid hash for any algorithm, so no password can ever match it.
        password_hash: 'walk-in:no-login',
        is_verified: false,
        user_profiles: { create: { full_name: dto.guestName } },
      },
    });
  }
}

/**
 * Reserves the next booking id.
 *
 * `booking_code` is derived from the id and the column is only 32 characters,
 * so there is no room for a placeholder long enough to be unique. Drawing the
 * id from the sequence first lets both be set in a single INSERT.
 */
async function nextBookingId(tx: Prisma.TransactionClient): Promise<bigint> {
  const [{ id }] = await tx.$queryRaw<{ id: bigint }[]>`
    SELECT nextval('bookings_booking_id_seq') AS id
  `;
  return BigInt(id);
}

/**
 * The name `0007_cancellation_policy_main.sql` seeds and `cancel()` falls
 * back to for a property that never picked one — see `policyIdFor`.
 */
const MAIN_POLICY_NAME = 'ຫຼັກ · Main';

/**
 * The cancellation policy the property is currently advertising, falling
 * back to the platform default so "never picked a policy" cannot mean
 * "unlimited free cancellation with no deadline," which is what happened
 * before this fallback existed.
 */
async function policyIdFor(tx: Prisma.TransactionClient, propertyId: bigint) {
  const property = await tx.properties.findUnique({
    where: { property_id: propertyId },
    select: { cancellation_policy_id: true },
  });
  if (property?.cancellation_policy_id) return property.cancellation_policy_id;

  const main = await tx.cancellation_policies.findFirst({
    where: { policy_name: MAIN_POLICY_NAME },
    select: { cancellation_policy_id: true },
  });
  return main?.cancellation_policy_id ?? null;
}

async function partnerUserId(tx: Prisma.TransactionClient, partnerId: bigint): Promise<bigint> {
  const partner = await tx.partners.findUniqueOrThrow({
    where: { partner_id: partnerId },
    select: { user_id: true },
  });
  return partner.user_id;
}

function defaultReason(role: user_role): string {
  switch (role) {
    case user_role.CUSTOMER:
      return 'ຍົກເລີກໂດຍແຂກ · Cancelled by the guest';
    case user_role.PARTNER:
      return 'ຍົກເລີກໂດຍທີ່ພັກ · Cancelled by the property';
    default:
      return 'ຍົກເລີກໂດຍຜູ້ດູແລ · Cancelled by admin';
  }
}

type BookingRow = {
  booking_id: bigint;
  booking_code: string;
  check_in: Date;
  check_out: Date;
  nights: number;
  total_guests: number;
  subtotal_amount: bigint;
  discount_amount: bigint;
  tax_amount: bigint;
  service_fee: bigint;
  cleaning_fee: bigint;
  commission_rate: Prisma.Decimal;
  commission_amount: bigint;
  total_amount: bigint;
  payout_amount: bigint;
  status: booking_status;
  source: booking_source;
  hold_expires_at: Date | null;
  special_request: string | null;
  created_at: Date;
};

/** Money leaves as numbers, ids as strings. See common/money.ts for why. */
export function toBookingView(b: BookingRow) {
  return {
    id: b.booking_id.toString(),
    code: b.booking_code,
    checkIn: b.check_in,
    checkOut: b.check_out,
    nights: b.nights,
    guests: b.total_guests,
    subtotal: kipOf(b.subtotal_amount),
    discount: kipOf(b.discount_amount),
    tax: kipOf(b.tax_amount),
    serviceFee: kipOf(b.service_fee),
    cleaningFee: kipOf(b.cleaning_fee),
    total: kipOf(b.total_amount),
    commissionRate: rateOf(b.commission_rate),
    commission: kipOf(b.commission_amount),
    payout: kipOf(b.payout_amount),
    status: b.status,
    source: b.source,
    holdExpiresAt: b.hold_expires_at,
    specialRequest: b.special_request,
    createdAt: b.created_at,
  };
}
