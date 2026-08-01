import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { BOOKING_STATUS } from '../../common/money';

export class CreateBookingDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(50)
  promoCode?: string;
}

export class ListMyBookingsDto extends PaginationDto {
  @IsOptional()
  @IsIn(Object.values(BOOKING_STATUS))
  status?: string;
}

export class CreateReviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;
}

export class CancelMyBookingDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
