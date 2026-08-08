import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { booking_status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from './inventory.service';

/**
 * Reclaims inventory from checkouts that were never paid for.
 *
 * A booking holds its nights the moment it is created, before any money moves.
 * That is what stops two guests buying the same room while one of them is in
 * their banking app. But a guest who closes the app instead of paying leaves
 * the hold behind, and without something to clear it the room is off sale
 * forever — the failure is silent, and by the time anyone notices, a month of
 * abandoned checkouts has taken the property's calendar apart.
 *
 * This is that something. It runs every minute; the `pending` +
 * `hold_expires_at` partial index makes the query cheap even when there is
 * nothing to do.
 */
@Injectable()
export class HoldSweeperService {
  private readonly logger = new Logger(HoldSweeperService.name);

  /** Stops two instances of the app fighting over the same expired holds. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'release-expired-holds' })
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const released = await this.releaseExpired();
      if (released > 0) {
        this.logger.log(`Released ${released} expired booking hold(s)`);
      }
    } catch (err) {
      // Never let a sweep failure kill the scheduler — it must try again next
      // minute, not stop for the lifetime of the process.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Hold sweep failed: ${message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Exposed so a test can force a sweep rather than wait for the clock.
   * @returns how many bookings were released.
   */
  async releaseExpired(now = new Date()): Promise<number> {
    const expired = await this.prisma.bookings.findMany({
      where: {
        status: booking_status.pending,
        hold_expires_at: { not: null, lt: now },
      },
      select: {
        booking_id: true,
        check_in: true,
        check_out: true,
        booking_items: { select: { room_type_id: true, quantity: true } },
      },
      // Bounded so one very stale backlog cannot hold a transaction open for
      // minutes; the next tick picks up the rest.
      take: 200,
    });

    let released = 0;

    for (const booking of expired) {
      try {
        // One transaction per booking. A single failure — a row that was
        // cancelled a moment ago, say — must not abandon the others.
        await this.prisma.$transaction(async (tx) => {
          // Re-read under the transaction: the guest may have paid between the
          // query above and this write, in which case the booking is no longer
          // ours to cancel.
          const current = await tx.bookings.findUnique({
            where: { booking_id: booking.booking_id },
            select: { status: true, hold_expires_at: true },
          });
          if (
            !current ||
            current.status !== booking_status.pending ||
            current.hold_expires_at === null ||
            current.hold_expires_at >= now
          ) {
            return;
          }

          for (const item of booking.booking_items) {
            await this.inventory.releaseHold(
              tx,
              item.room_type_id,
              booking.check_in,
              booking.check_out,
              item.quantity,
            );
          }

          await tx.bookings.update({
            where: { booking_id: booking.booking_id },
            data: { status: booking_status.cancelled, hold_expires_at: null },
          });

          await tx.booking_status_logs.create({
            data: {
              booking_id: booking.booking_id,
              from_status: booking_status.pending,
              to_status: booking_status.cancelled,
              // Null: the system did this, not a person.
              changed_by: null,
              note: 'ໝົດເວລາຈອງ ຄືນຫ້ອງເຂົ້າຄັງ · Hold expired, inventory released',
            },
          });

          released++;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Could not release hold on booking ${booking.booking_id}: ${message}`);
      }
    }

    return released;
  }
}
