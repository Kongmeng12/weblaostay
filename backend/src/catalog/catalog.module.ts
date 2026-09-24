import { Module } from '@nestjs/common';
import { AdminLocationsController, CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PlaceResolverService } from './place-resolver.service';
import { BookingModule } from '../booking/booking.module';

/** Public browsing: search, property detail, availability calendar, master data. */
@Module({
  imports: [BookingModule],
  controllers: [CatalogController, AdminLocationsController],
  providers: [CatalogService, PlaceResolverService],
  exports: [CatalogService],
})
export class CatalogModule {}
