import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from './settings.service';
import {
  BOOKING_STATUS,
  PAYMENT_STATUS,
  AVAILABILITY_STATUS,
  cancellationSplit,
  bookingCode,
} from './money';
import { ACTOR, type ActorType } from './actors';

/**
 * Cancelling a booking, wherever the request came from.
 *
 * An admin cancelling from the WebAdmin and a guest cancelling in the app must
 * produce identical rows — same fee, same refund, same nights released. Two
 * copies of this would drift, and the first symptom would be a room nobody can
 * book because its calendar was never cleared.
 */
@Injectable()
export class CancellationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Cancel and refund, as one transaction.
   *
   * Three things must agree afterwards or the books are wrong: the booking is
   * cancelled, the cancellation row records fee vs refund, and the nights are
   * released back into `room_availability` so they can be sold again.
   */
  async cancel(id: bigint, reason: string | undefined, by: ActorType) {
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
      // Once the guest has checked in only the front desk can settle up, so a
      // self-service cancellation is refused rather than silently refunded.
      if (by === ACTOR.USER && booking.status === BOOKING_STATUS.STAYING) {
        throw new BadRequestException(
          'ເຂົ້າພັກແລ້ວ ຍົກເລີກເອງບໍ່ໄດ້ · Contact the property once you have checked in',
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
          reason: reason?.slice(0, 255) ?? DEFAULT_REASON[by],
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

      // Tell whoever did not press the button.
      const notices =
        by === ACTOR.USER
          ? [
              {
                recipient_type: ACTOR.PARTNER,
                recipient_id: await partnerIdFor(tx, booking.property_id),
                title: 'ການຈອງຖືກຍົກເລີກ',
                body: `ແຂກຍົກເລີກການຈອງ ${bookingCode(id)}`,
                type: 'booking',
              },
            ]
          : [
              {
                recipient_type: ACTOR.USER,
                recipient_id: booking.user_id,
                title: 'ການຈອງຖືກຍົກເລີກ',
                body: `ການຈອງ ${bookingCode(id)} ຖືກຍົກເລີກ · ຄືນເງິນ ₭${refund.toLocaleString('en-US')}`,
                type: 'booking',
              },
            ];

      await tx.notifications.createMany({ data: notices });

      return { booking: { id, status: BOOKING_STATUS.CANCELLED }, cancellation, paid, fee, refund };
    });
  }
}

const DEFAULT_REASON: Record<ActorType, string> = {
  [ACTOR.ADMIN]: 'ຍົກເລີກໂດຍຜູ້ດູແລ · Cancelled by admin',
  [ACTOR.PARTNER]: 'ຍົກເລີກໂດຍທີ່ພັກ · Cancelled by the property',
  [ACTOR.USER]: 'ຍົກເລີກໂດຍແຂກ · Cancelled by the guest',
};

async function partnerIdFor(
  tx: Prisma.TransactionClient,
  propertyId: bigint,
): Promise<bigint> {
  const property = await tx.properties.findUniqueOrThrow({
    where: { id: propertyId },
    select: { partner_id: true },
  });
  return property.partner_id;
}
