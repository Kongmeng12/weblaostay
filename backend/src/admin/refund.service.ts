import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { refund_status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { kipOf } from '../common/money';

/**
 * Money owed back to guests.
 *
 * Cancelling a paid stay records what is owed; it does not send it. PhaJay's
 * refund API returns a charge in full and takes no amount, while a cancellation
 * policy almost always keeps a percentage — so every refund here is a partial
 * one that has to be transferred by hand from PhaJay's portal.
 *
 * This screen is the list of who is still waiting, and the record of when
 * somebody actually paid them.
 */
@Injectable()
export class RefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(status?: refund_status) {
    const rows = await this.prisma.refunds.findMany({
      where: status ? { status } : {},
      // Oldest first: a guest who has been waiting longest is served first.
      orderBy: [{ status: 'asc' }, { created_at: 'asc' }],
      take: 200,
      include: {
        bookings: {
          select: {
            booking_code: true,
            total_amount: true,
            users: {
              select: { email: true, phone: true, user_profiles: { select: { full_name: true } } },
            },
            properties: { select: { property_name: true } },
          },
        },
        payments: { select: { amount: true, txn_ref: true, paid_at: true } },
      },
    });

    return rows.map((r) => ({
      id: r.refund_id.toString(),
      bookingCode: r.bookings.booking_code,
      property: r.bookings.properties.property_name,
      guest: r.bookings.users.user_profiles?.full_name ?? r.bookings.users.email,
      guestPhone: r.bookings.users.phone,
      guestEmail: r.bookings.users.email,
      /** What the guest paid, and what they get back — the difference is the penalty. */
      paid: kipOf(r.payments.amount),
      amount: kipOf(r.amount),
      /** PhaJay's id for the original charge — what to search for in their portal. */
      txnRef: r.payments.txn_ref,
      reason: r.reason,
      status: r.status,
      requestedAt: r.created_at,
      refundedAt: r.refunded_at,
    }));
  }

  async counts() {
    const rows = await this.prisma.refunds.groupBy({
      by: ['status'],
      _count: true,
      _sum: { amount: true },
    });
    return Object.fromEntries(
      rows.map((r) => [r.status, { count: r._count, amount: kipOf(r._sum.amount ?? 0n) }]),
    );
  }

  /**
   * Records that the money has been sent.
   *
   * Only a person can say this, because only a person made the transfer. The
   * guest is told at the same moment — they have been watching a "pending" line
   * on their trip since they cancelled.
   */
  async markPaid(refundId: bigint, adminUserId: bigint, note?: string) {
    const refund = await this.prisma.refunds.findUnique({
      where: { refund_id: refundId },
      include: { bookings: { select: { booking_code: true, customer_id: true } } },
    });
    if (!refund) throw new NotFoundException(`ບໍ່ພົບການຄືນເງິນ #${refundId} · Refund not found`);

    if (refund.status === refund_status.completed) {
      throw new BadRequestException('ຄືນເງິນນີ້ບັນທຶກວ່າສຳເລັດແລ້ວ · This refund is already marked paid');
    }

    const updated = await this.prisma.refunds.update({
      where: { refund_id: refundId },
      data: {
        status: refund_status.completed,
        refunded_at: new Date(),
        processed_by: adminUserId,
        ...(note && { reason: note.slice(0, 255) }),
      },
    });

    await this.notifications.send(null, {
      userId: refund.bookings.customer_id,
      templateCode: 'refund_completed',
      vars: {
        booking_code: refund.bookings.booking_code,
        amount: kipOf(refund.amount).toLocaleString('en-US'),
      },
      referenceType: 'booking',
      referenceId: refund.booking_id,
    });

    return { id: updated.refund_id.toString(), status: updated.status };
  }

  /** Marks a refund as failed, so it stops sitting in the queue unexplained. */
  async markFailed(refundId: bigint, adminUserId: bigint, reason: string) {
    const refund = await this.prisma.refunds.findUnique({ where: { refund_id: refundId } });
    if (!refund) throw new NotFoundException(`ບໍ່ພົບການຄືນເງິນ #${refundId} · Refund not found`);

    // The guest has already been told the money is on its way. Undoing that
    // needs a new refund record, not a status the notification no longer matches.
    if (refund.status === refund_status.completed) {
      throw new BadRequestException(
        'ຄືນເງິນນີ້ບັນທຶກວ່າສຳເລັດແລ້ວ ປ່ຽນເປັນລົ້ມເຫຼວບໍ່ໄດ້ · A completed refund cannot be marked failed',
      );
    }

    const updated = await this.prisma.refunds.update({
      where: { refund_id: refundId },
      data: {
        status: refund_status.failed,
        processed_by: adminUserId,
        reason: reason.slice(0, 255),
      },
    });
    return { id: updated.refund_id.toString(), status: updated.status };
  }
}
