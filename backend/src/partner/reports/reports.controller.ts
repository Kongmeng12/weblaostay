import { Controller, Get, Query } from '@nestjs/common';
import { user_role } from '@prisma/client';
import { ReportsService } from './reports.service';
import { OwnershipService } from '../ownership.service';
import { CurrentUser, Roles, type AuthedUser } from '../../common/decorators';
import { ReportQueryDto } from './reports.dto';

/**
 * Date-range reporting for a partner's own properties — revenue, payouts,
 * bookings, occupancy, cancellations/refunds, reviews, promotions. Every
 * `/partner/*` aggregate endpoint elsewhere (dashboard, status-counts,
 * payouts) is a live snapshot; these are the arbitrary-range equivalents,
 * built for the in-app charts/tables and CSV/PDF export in the partner app.
 */
@Controller('partner/reports')
@Roles(user_role.PARTNER)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly own: OwnershipService,
  ) {}

  @Get('revenue')
  revenue(@CurrentUser() user: AuthedUser, @Query() query: ReportQueryDto) {
    return this.reports.revenue(this.own.partnerId(user), query);
  }

  @Get('payouts')
  payouts(@CurrentUser() user: AuthedUser, @Query() query: ReportQueryDto) {
    return this.reports.payouts(this.own.partnerId(user), query);
  }

  @Get('bookings')
  bookings(@CurrentUser() user: AuthedUser, @Query() query: ReportQueryDto) {
    return this.reports.bookings(this.own.partnerId(user), query);
  }

  @Get('occupancy')
  occupancy(@CurrentUser() user: AuthedUser, @Query() query: ReportQueryDto) {
    return this.reports.occupancy(this.own.partnerId(user), query);
  }

  @Get('cancellations')
  cancellations(@CurrentUser() user: AuthedUser, @Query() query: ReportQueryDto) {
    return this.reports.cancellations(this.own.partnerId(user), query);
  }

  @Get('reviews')
  reviews(@CurrentUser() user: AuthedUser, @Query() query: ReportQueryDto) {
    return this.reports.reviews(this.own.partnerId(user), query);
  }

  @Get('promotions')
  promotions(@CurrentUser() user: AuthedUser, @Query() query: ReportQueryDto) {
    return this.reports.promotions(this.own.partnerId(user), query);
  }
}
