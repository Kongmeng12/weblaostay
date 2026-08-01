import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PartnerBookingsService } from './bookings.service';
import { OwnershipService } from '../ownership.service';
import { CancellationService } from '../../common/cancellation.service';
import {
  ListPartnerBookingsDto,
  SetBookingStatusDto,
  WalkInDto,
  CancelBookingDto,
} from './bookings.dto';
import { Actor, Audit, CurrentPartner, type AuthedPartner } from '../../common/decorators';
import { ACTOR } from '../../common/actors';

@Controller('partner/bookings')
@Actor(ACTOR.PARTNER)
export class PartnerBookingsController {
  constructor(
    private readonly bookings: PartnerBookingsService,
    private readonly cancellations: CancellationService,
    private readonly own: OwnershipService,
  ) {}

  @Get()
  list(@CurrentPartner() partner: AuthedPartner, @Query() query: ListPartnerBookingsDto) {
    return this.bookings.list(partner.id, query);
  }

  @Get('status-counts')
  statusCounts(@CurrentPartner() partner: AuthedPartner) {
    return this.bookings.statusCounts(partner.id);
  }

  @Get(':id')
  findOne(@CurrentPartner() partner: AuthedPartner, @Param('id') id: string) {
    return this.bookings.findOne(partner.id, BigInt(id));
  }

  @Patch(':id/status')
  @Audit('partner_booking_status', 'bookings:id')
  setStatus(
    @CurrentPartner() partner: AuthedPartner,
    @Param('id') id: string,
    @Body() dto: SetBookingStatusDto,
  ) {
    return this.bookings.setStatus(partner.id, BigInt(id), dto.status);
  }

  /** Records a guest who booked at the desk — `source = walk_in`. */
  @Post('walk-in')
  @Audit('partner_walkin_create')
  walkIn(@CurrentPartner() partner: AuthedPartner, @Body() dto: WalkInDto) {
    this.own.assertVerified(partner);
    return this.bookings.createWalkIn(partner.id, dto);
  }

  /**
   * Cancelling refunds the guest and frees the nights, so it goes through the
   * shared CancellationService rather than a partner-specific copy.
   */
  @Post(':id/cancel')
  @HttpCode(200)
  @Audit('partner_booking_cancel', 'bookings:id')
  async cancel(
    @CurrentPartner() partner: AuthedPartner,
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
  ) {
    const bookingId = BigInt(id);
    await this.own.assertOwnsBooking(partner.id, bookingId);
    return this.cancellations.cancel(bookingId, dto.reason, ACTOR.PARTNER);
  }
}
