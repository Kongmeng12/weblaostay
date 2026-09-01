import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { booking_status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Completes bookings once their checkout date has passed.
 *
 * Nothing else in the system ever writes `completed` automatically — the only
 * other path is a partner manually walking a booking through
 * `confirmed → staying → completed`. Most properties never bother with that,
 * so without this sweeper a finished stay sits as `confirmed` forever: it
 * never reaches the Trips screen's history tab, its status badge never
 * updates, and the guest can never leave a review (the review endpoint
 * requires `status === completed`).
 *
 * Goes straight from `confirmed` (or `staying`, for the properties that do
 * check guests in) to `completed` — never routes through `staying` itself.
 * `lib/models/booking.dart`'s status parser on the Flutter side doesn't
 * recognise `staying` and would silently show the booking as "Unpaid" if
 * this ever wrote it. `no_show` is left untouched: that's a human judgment
 * call, not something a date-based sweep should infer.
 */
@Injectable()
export class CheckoutSweeperService {
  private readonly logger = new Logger(CheckoutSweeperService.name);

  /** Stops two instances of the app fighting over the same past checkouts. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'complete-past-checkouts' })
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const completed = await this.completeExpired();
      if (completed > 0) {
        this.logger.log(`Completed ${completed} past-checkout booking(s)`);
      }
    } catch (err) {
      // Never let a sweep failure kill the scheduler — it must try again next
      // hour, not stop for the lifetime of the process.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Checkout sweep failed: ${message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Exposed so a test (or a one-off manual run) can force a sweep rather
   * than wait for the clock.
   * @returns how many bookings were completed.
   */
  async completeExpired(now = new Date()): Promise<number> {
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const dueOut = await this.prisma.bookings.findMany({
      where: {
        status: { in: [booking_status.confirmed, booking_status.staying] },
        check_out: { lt: startOfToday },
      },
      select: {
        booking_id: true,
        customer_id: true,
        properties: { select: { property_name: true } },
      },
      // Bounded so one very stale backlog cannot hold a transaction open for
      // minutes; the next tick picks up the rest.
      take: 200,
    });

    let completed = 0;

    for (const booking of dueOut) {
      try {
        // One transaction per booking. A single failure — a row that was
        // cancelled a moment ago, say — must not abandon the others.
        await this.prisma.$transaction(async (tx) => {
          // Re-read under the transaction: the booking may have been
          // cancelled, or already swept, between the query above and here.
          const current = await tx.bookings.findUnique({
            where: { booking_id: booking.booking_id },
            select: { status: true, check_out: true },
          });
          if (
            !current ||
            (current.status !== booking_status.confirmed && current.status !== booking_status.staying) ||
            current.check_out >= startOfToday
          ) {
            return;
          }

          await tx.bookings.update({
            where: { booking_id: booking.booking_id },
            data: { status: booking_status.completed },
          });

          await tx.booking_status_logs.create({
            data: {
              booking_id: booking.booking_id,
              from_status: current.status,
              to_status: booking_status.completed,
              // Null: the system did this, not a person.
              changed_by: null,
              note: 'ອອກຫ້ອງແລ້ວ ພັກສຳເລັດອັດຕະໂນມັດ · Checkout date passed, marked complete',
            },
          });

          await this.notifications.send(tx, {
            userId: booking.customer_id,
            templateCode: 'stay_completed_review_prompt',
            vars: { property: booking.properties.property_name },
            referenceType: 'booking',
            referenceId: booking.booking_id,
          });

          completed++;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Could not complete booking ${booking.booking_id}: ${message}`);
      }
    }

    return completed;
  }
}
