import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CustomerBookingsService } from './bookings.service';
import { CancellationService } from '../../common/cancellation.service';
import {
  CreateBookingDto,
  ListMyBookingsDto,
  CreateReviewDto,
  CancelMyBookingDto,
} from './bookings.dto';
import { Actor, CurrentUser, type AuthedUser } from '../../common/decorators';
import { ACTOR } from '../../common/actors';

@Controller('customer/bookings')
@Actor(ACTOR.USER)
export class CustomerBookingsController {
  constructor(
    private readonly bookings: CustomerBookingsService,
    private readonly cancellations: CancellationService,
  ) {}

  /** Price the stay before committing to it. Writes nothing. */
  @HttpCode(200)
  @Post('quote')
  quote(@Body() dto: CreateBookingDto) {
    return this.bookings.quote(dto);
  }

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreateBookingDto) {
    return this.bookings.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthedUser, @Query() query: ListMyBookingsDto) {
    return this.bookings.list(user.id, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.bookings.findOne(user.id, BigInt(id));
  }

  /**
   * Cancelling refunds and frees the nights through the same service the admin
   * panel uses, so the two can never produce different rows.
   */
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: CancelMyBookingDto,
  ) {
    const bookingId = BigInt(id);
    // Ownership check first: findOne is scoped to this user and 404s otherwise.
    await this.bookings.findOne(user.id, bookingId);
    return this.cancellations.cancel(bookingId, dto.reason, ACTOR.USER);
  }

  @Post(':id/review')
  review(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.bookings.review(user.id, BigInt(id), dto);
  }
}
