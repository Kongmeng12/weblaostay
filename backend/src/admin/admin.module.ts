import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { PayoutService } from './payout.service';
import { RefundService } from './refund.service';
import { BookingModule } from '../booking/booking.module';
import { AuthModule } from '../auth/auth.module';

/**
 * What the WebAdmin talks to: approvals, oversight, and the money levers.
 *
 * AuthModule is imported for PasswordService — adding a member of staff is the
 * one place outside sign-up that hashes a password.
 */
@Module({
  imports: [BookingModule, AuthModule],
  controllers: [AdminController],
  providers: [PayoutService, RefundService],
  exports: [PayoutService, RefundService],
})
export class AdminModule {}
