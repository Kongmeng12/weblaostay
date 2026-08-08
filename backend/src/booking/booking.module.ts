import { Module } from '@nestjs/common';
import { BookingService } from './booking.service';
import { InventoryService } from './inventory.service';
import { PricingService } from './pricing.service';
import { LedgerService } from './ledger.service';
import { HoldSweeperService } from './hold-sweeper.service';
import { CustomerController } from './customer.controller';

/**
 * The booking domain: pricing, inventory holds, the ledger, and the sweeper
 * that reclaims abandoned checkouts.
 *
 * Everything here is exported because payments, the partner API and the admin
 * API all move the same rows — and they must move them the same way.
 */
@Module({
  controllers: [CustomerController],
  providers: [
    BookingService,
    InventoryService,
    PricingService,
    LedgerService,
    HoldSweeperService,
  ],
  exports: [BookingService, InventoryService, PricingService, LedgerService, HoldSweeperService],
})
export class BookingModule {}
