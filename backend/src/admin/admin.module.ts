import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';

import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { BookingsController } from './bookings/bookings.controller';
import { BookingsService } from './bookings/bookings.service';
import { CustomersController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import { PayoutsController } from './payouts/payouts.controller';
import { PayoutsService } from './payouts/payouts.service';
import { ApprovalsController } from './approvals/approvals.controller';
import { ApprovalsService } from './approvals/approvals.service';
import { PartnersController } from './partners/partners.controller';
import { PartnersService } from './partners/partners.service';
import { ReviewsController } from './reviews/reviews.controller';
import { ReviewsService } from './reviews/reviews.service';
import { PromosController } from './promos/promos.controller';
import { PromosService } from './promos/promos.service';
import { SettingsController } from './settings/settings.controller';

/**
 * The nine WebAdmin screens. PrismaModule and CommonModule are global, so only
 * AuthModule needs importing here (Settings creates admins through it).
 */
@Module({
  imports: [AuthModule],
  controllers: [
    DashboardController,
    BookingsController,
    CustomersController,
    PayoutsController,
    ApprovalsController,
    PartnersController,
    ReviewsController,
    PromosController,
    SettingsController,
  ],
  providers: [
    DashboardService,
    BookingsService,
    CustomersService,
    PayoutsService,
    ApprovalsService,
    PartnersService,
    ReviewsService,
    PromosService,
  ],
})
export class AdminModule {}
