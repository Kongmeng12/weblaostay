import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { BOOKING_STATUS, type BookingStatus } from '../../common/money';

export class ListPartnerBookingsDto extends PaginationDto {
  @IsOptional()
  @IsIn(Object.values(BOOKING_STATUS))
  status?: BookingStatus;
}

/** Only the forward moves; cancelling has its own endpoint. */
export class SetBookingStatusDto {
  @IsIn([BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.STAYING, BOOKING_STATUS.DONE])
  status!: BookingStatus;
}

export class WalkInDto {
  @IsString()
  roomId!: string;

  @IsISO8601()
  checkIn!: string;

  @IsISO8601()
  checkOut!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  guests!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  guestName!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(50)
  guestPhone!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  guestEmail?: string;
}

export class CancelBookingDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
