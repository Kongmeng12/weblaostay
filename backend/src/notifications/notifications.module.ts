import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

/**
 * Notifications.
 *
 * Global because almost every module has a reason to tell somebody something —
 * bookings, payments, payouts, approvals, chat — and threading an import
 * through all of them adds nothing.
 *
 * **Delivery is not here yet.** This writes the in-app row; SMS, email and push
 * need a provider each, following the swappable-provider pattern in
 * `payments.module.ts`, and each needs a vendor chosen first. When they arrive,
 * they hang off `send()` — and must fire *after* the caller's transaction
 * commits, or a rolled-back booking will still have sent someone a text.
 */
@Global()
@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
