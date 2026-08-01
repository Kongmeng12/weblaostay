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
import { PROPERTY_TYPES } from '../../common/money';

export const SEARCH_SORTS = ['rating', 'price_asc', 'price_desc', 'reviews'] as const;

export class SearchDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;

  @IsOptional()
  @IsIn(PROPERTY_TYPES)
  type?: string;

  /** Both dates or neither — one alone cannot describe a stay. */
  @IsOptional()
  @IsISO8601()
  checkIn?: string;

  @IsOptional()
  @IsISO8601()
  checkOut?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  guests?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsIn(SEARCH_SORTS)
  sort?: string;
}

export class StayRangeDto {
  @IsOptional()
  @IsISO8601()
  checkIn?: string;

  @IsOptional()
  @IsISO8601()
  checkOut?: string;
}

export class CalendarQueryDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}

export class ValidatePromoDto {
  @IsString()
  @MaxLength(50)
  code!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  subtotal?: number;
}
