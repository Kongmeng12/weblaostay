import { Module } from '@nestjs/common';
import { OwnershipService } from './ownership.service';
import { PartnerProfileController } from './profile.controller';
import { PartnerDashboardController } from './dashboard/dashboard.controller';
import { PartnerPropertiesController } from './properties/properties.controller';
import { PartnerPropertiesService } from './properties/properties.service';
import { PartnerAvailabilityController } from './availability/availability.controller';
import { PartnerBookingsController } from './bookings/bookings.controller';
import { PartnerBookingsService } from './bookings/bookings.service';

/**
 * Everything the Flutter partner app talks to. PrismaModule and CommonModule
 * are global, so nothing needs importing here.
 *
 * OwnershipService is exported because the uploads module also has to prove a
 * property belongs to the partner before writing photos onto it.
 */
@Module({
  controllers: [
    PartnerProfileController,
    PartnerDashboardController,
    PartnerPropertiesController,
    PartnerAvailabilityController,
    PartnerBookingsController,
  ],
  providers: [OwnershipService, PartnerPropertiesService, PartnerBookingsService],
  exports: [OwnershipService],
})
export class PartnerModule {}
