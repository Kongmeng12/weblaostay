import { Module } from '@nestjs/common';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';
import { OwnershipService } from './ownership.service';
import { CalendarService } from './calendar.service';
import { BookingModule } from '../booking/booking.module';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';

/**
 * Everything the Flutter partner app talks to.
 *
 * OwnershipService is exported because the uploads module also has to prove a
 * property belongs to the caller before writing photos onto it.
 *
 * Reports lives in its own controller/service pair (`reports/`) rather than
 * being folded into `PartnerController`/`PartnerService` — it's raw-query/
 * bucketing-heavy, a different flavor of code from the CRUD-and-ownership
 * style filling those files — but registers flatly here rather than as its
 * own `@Module()`, so it can share this module's `OwnershipService` instance
 * without a circular import.
 */
@Module({
  imports: [BookingModule],
  controllers: [PartnerController, ReportsController],
  providers: [PartnerService, OwnershipService, CalendarService, ReportsService],
  exports: [OwnershipService],
})
export class PartnerModule {}
