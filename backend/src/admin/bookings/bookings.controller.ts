import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { BookingsService } from './bookings.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { Audit, Roles } from '../../common/decorators';
import { MONEY_ROLES } from '../../common/roles';
import { BOOKING_STATUS, type BookingStatus } from '../../common/money';

const STATUSES = Object.values(BOOKING_STATUS);

class ListBookingsDto extends PaginationDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: BookingStatus;
}

class SetStatusDto {
  @IsIn(STATUSES)
  status!: BookingStatus;
}

class CancelDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

@Controller('admin/bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  list(@Query() query: ListBookingsDto) {
    return this.bookings.list(query);
  }

  @Get('status-counts')
  counts() {
    return this.bookings.statusCounts();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.bookings.findOne(BigInt(id));
  }

  @Patch(':id/status')
  @Audit('booking_status_change', 'bookings:id')
  setStatus(@Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.bookings.setStatus(BigInt(id), dto.status);
  }

  /** Cancelling moves money, so staff cannot do it. */
  @Post(':id/cancel')
  @Roles(...MONEY_ROLES)
  @Audit('booking_cancel_refund', 'bookings:id')
  cancel(@Param('id') id: string, @Body() dto: CancelDto) {
    return this.bookings.cancel(BigInt(id), dto.reason);
  }
}
