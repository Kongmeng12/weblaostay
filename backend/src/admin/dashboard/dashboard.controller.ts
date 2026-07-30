import { Controller, Get, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('kpis')
  kpis() {
    return this.dashboard.kpis();
  }

  @Get('gmv')
  gmv(@Query('days', new DefaultValuePipe(14), ParseIntPipe) days: number) {
    return this.dashboard.gmv(Math.min(Math.max(days, 1), 90));
  }

  @Get('recent-bookings')
  recent(@Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number) {
    return this.dashboard.recentBookings(Math.min(Math.max(limit, 1), 50));
  }

  @Get('payout-summary')
  payoutSummary() {
    return this.dashboard.payoutSummary();
  }
}
