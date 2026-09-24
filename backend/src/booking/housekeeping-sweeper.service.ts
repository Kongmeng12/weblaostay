import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Flags a room as needing housekeeping once a guest's checkout date has
 * passed, so the Today Board shows it as dirty rather than silently
 * "available" for the next guest before anyone has actually cleaned it.
 *
 * Only individually-numbered rooms (`rooms` rows — properties with
 * `allow_room_selection` on) have a status to flag at all; room types
 * without them have nothing this sweep touches.
 */
@Injectable()
export class HousekeepingSweeperService {
  private readonly logger = new Logger(HousekeepingSweeperService.name);

  /** Stops two instances of the app racing the same rows. */
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'flag-rooms-needing-cleaning' })
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const flagged = await this.flagNeedsCleaning();
      if (flagged > 0) {
        this.logger.log(`Flagged ${flagged} room(s) as needing cleaning`);
      }
    } catch (err) {
      // Never let a sweep failure kill the scheduler — it must try again next
      // tick, not stop for the lifetime of the process.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Housekeeping sweep failed: ${message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Exposed so a test (or the plan's verification step) can force a sweep
   * rather than wait for the clock.
   * @returns how many rooms were flagged.
   */
  async flagNeedsCleaning(): Promise<number> {
    // Only rooms still `available` are touched — a room a partner marked
    // `maintenance`/`inactive` by hand keeps that status; this sweep must
    // not overwrite a deliberate manual call with an automatic one.
    //
    // `staying` covers a guest who is still checked in past their stated
    // checkout (the room isn't clean and available either way); `completed`
    // covers the ordinary case where the front desk already closed the
    // booking out.
    //
    // `r.updated_at < ra.check_out` is what stops a room being flagged dirty
    // again the moment it has been cleaned: without it *any* room that has
    // ever hosted a finished stay matched on every run, so "mark clean" was
    // undone within ten minutes. Marking a room clean (and flagging it dirty)
    // stamps `updated_at`, so a room only qualifies while it has not been
    // touched since the day its guest was due out.
    const result = await this.prisma.$executeRaw`
      UPDATE rooms SET status = 'needs_cleaning', updated_at = now()
      WHERE room_id IN (
        SELECT r.room_id
        FROM room_assignments ra
        JOIN booking_items bi ON bi.booking_item_id = ra.booking_item_id
        JOIN bookings b ON b.booking_id = bi.booking_id
        JOIN rooms r ON r.room_id = ra.room_id
        WHERE ra.check_out <= CURRENT_DATE
          AND b.status IN ('staying', 'completed')
          AND r.status = 'available'
          AND r.updated_at < ra.check_out
      )
    `;
    return result;
  }
}
