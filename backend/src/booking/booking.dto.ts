import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { booking_status } from '@prisma/client';
import { PaginationDto } from '../common/dto/pagination.dto';

export class CreateBookingDto {
  @IsString()
  roomTypeId!: string;

  @IsISO8601()
  checkIn!: string;

  @IsISO8601()
  checkOut!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  guests!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  specialRequest?: string;

  /**
   * Supplied by the client so a retried request returns the original booking
   * instead of creating a second one.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;
}

export class WalkInDto {
  @IsString()
  roomTypeId!: string;

  @IsISO8601()
  checkIn!: string;

  @IsISO8601()
  checkOut!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  guests!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  quantity?: number;

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

export class ListBookingsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(booking_status)
  status?: booking_status;
}

/** Only the forward moves; cancelling has its own endpoint. */
export class SetBookingStatusDto {
  @IsEnum(booking_status)
  status!: booking_status;
}

export class CancelBookingDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class CreateReviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  cleanliness?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  service?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  value?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
