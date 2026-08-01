import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BED_TYPES, PROPERTY_TYPES } from '../../common/money';

export class CreatePropertyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @IsIn(PROPERTY_TYPES)
  type!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  province!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(500)
  address!: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  /** Free-form `{wifi: true, parking: true, …}` — stored as jsonb. */
  @IsOptional()
  @IsObject()
  amenities?: Record<string, unknown>;
}

export class UpdatePropertyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsIn(PROPERTY_TYPES)
  type?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  province?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsObject()
  amenities?: Record<string, unknown>;
}

export class RoomDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  roomNo?: string;

  @IsOptional()
  @IsBoolean()
  hasAc?: boolean;

  @IsIn(BED_TYPES)
  bedType!: string;

  /** Whole kip. There are no subunits, so a decimal here is a mistake. */
  @Type(() => Number)
  @IsInt({ message: 'ລາຄາຕ້ອງເປັນຈຳນວນເຕັມກີບ · Price must be whole kip' })
  @Min(1000)
  @Max(500_000_000)
  basePrice!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  capacity!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  qty!: number;
}

export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  roomNo?: string;

  @IsOptional()
  @IsBoolean()
  hasAc?: boolean;

  @IsOptional()
  @IsIn(BED_TYPES)
  bedType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'ລາຄາຕ້ອງເປັນຈຳນວນເຕັມກີບ · Price must be whole kip' })
  @Min(1000)
  @Max(500_000_000)
  basePrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  capacity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  qty?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
