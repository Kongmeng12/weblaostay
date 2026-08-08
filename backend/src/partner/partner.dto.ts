import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { bed_type, inventory_status, price_type, property_type } from '@prisma/client';

export class UpdatePropertyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEnum(property_type)
  type?: property_type;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  provinceId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  districtId?: number;

  @IsOptional()
  @IsString()
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
  @Type(() => Number)
  @IsInt()
  cancellationPolicyId?: number;

  /** Replaces the whole amenity set when supplied. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ each: true })
  amenityIds?: number[];
}

export class RoomTypeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsEnum(bed_type)
  bedType!: bed_type;

  @IsOptional()
  @IsBoolean()
  hasAc?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  maxOccupancy!: number;

  /** Whole kip. There are no subunits, so a decimal here is a mistake. */
  @Type(() => Number)
  @IsInt({ message: 'ລາຄາຕ້ອງເປັນຈຳນວນເຕັມກີບ · Price must be whole kip' })
  @Min(1000)
  basePrice!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  totalRooms!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  minNights?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  extraGuestFee?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeSqm?: number;
}

export class UpdateRoomTypeDto extends RoomTypeDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** `to` is exclusive, matching a stay's check-out. */
export class DateRangeDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}

export class SetInventoryDto extends DateRangeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500)
  totalCount?: number;

  @IsOptional()
  @IsEnum(inventory_status)
  status?: inventory_status;
}

export class SetPriceDto extends DateRangeDto {
  @Type(() => Number)
  @IsInt({ message: 'ລາຄາຕ້ອງເປັນຈຳນວນເຕັມກີບ · Price must be whole kip' })
  @Min(1000)
  price!: number;

  @IsOptional()
  @IsEnum(price_type)
  priceType?: price_type;
}

export class UpdatePartnerProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  businessName?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(50)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxId?: string;
}

export class BankAccountDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  bankName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  accountName!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(255)
  accountNumber!: string;
}
