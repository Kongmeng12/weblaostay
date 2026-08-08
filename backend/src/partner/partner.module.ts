import { Module } from '@nestjs/common';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';
import { OwnershipService } from './ownership.service';
import { BookingModule } from '../booking/booking.module';

/**
 * Everything the Flutter partner app talks to.
 *
 * OwnershipService is exported because the uploads module also has to prove a
 * property belongs to the caller before writing photos onto it.
 */
@Module({
  imports: [BookingModule],
  controllers: [PartnerController],
  providers: [PartnerService, OwnershipService],
  exports: [OwnershipService],
})
export class PartnerModule {}
