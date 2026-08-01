import { Module } from '@nestjs/common';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { CustomerBookingsController } from './bookings/bookings.controller';
import { CustomerBookingsService } from './bookings/bookings.service';
import { CustomerProfileController } from './profile.controller';

/**
 * The guest-facing API. The catalogue half is public (browsing needs no
 * account); everything under /customer requires a customer token.
 */
@Module({
  controllers: [CatalogController, CustomerBookingsController, CustomerProfileController],
  providers: [CatalogService, CustomerBookingsService],
  exports: [CustomerBookingsService],
})
export class CustomerModule {}
