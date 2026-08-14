import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { otp_purpose, property_type } from '@prisma/client';

/** Loose enough for `+856 20 5555 0001`, `020 5555 0001`, `2055550001`, ... */
const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{5,19}$/;
const PHONE_MESSAGE = 'ເບີໂທບໍ່ຖືກຕ້ອງ · Invalid phone number';

export class LoginDto {
  /** Email or phone — whichever the account was found by. */
  @IsString()
  @MinLength(4, { message: 'ອີເມວ ຫຼື ເບີໂທບໍ່ຖືກຕ້ອງ · Invalid email or phone' })
  @MaxLength(255)
  identifier!: string;

  @IsString()
  @MinLength(8, { message: 'ລະຫັດຜ່ານຢ່າງໜ້ອຍ 8 ຕົວອັກສອນ · Minimum 8 characters' })
  @MaxLength(128)
  password!: string;
}

export class RegisterCustomerDto {
  @IsEmail({}, { message: 'ອີເມວບໍ່ຖືກຕ້ອງ · Invalid email' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'ລະຫັດຜ່ານຢ່າງໜ້ອຍ 8 ຕົວອັກສອນ · Minimum 8 characters' })
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName!: string;

  @IsString()
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  @MaxLength(50)
  phone!: string;
}

/**
 * A partner signs up with their account, their business, and their first
 * property. An application with no property is nothing for the Approvals
 * screen to review, so all three are created in one transaction.
 */
export class RegisterPartnerDto {
  @IsEmail({}, { message: 'ອີເມວບໍ່ຖືກຕ້ອງ · Invalid email' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'ລະຫັດຜ່ານຢ່າງໜ້ອຍ 8 ຕົວອັກສອນ · Minimum 8 characters' })
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  ownerName!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(50)
  phone!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  businessName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  propertyName!: string;

  @IsEnum(property_type, {
    message: `ປະເພດທີ່ພັກຕ້ອງເປັນ: ${Object.values(property_type).join(' | ')}`,
  })
  propertyType!: property_type;

  @Type(() => Number)
  @IsInt()
  provinceId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  districtId?: number;

  @IsString()
  @MinLength(4)
  @MaxLength(500)
  address!: string;
}

export class RefreshDto {
  @IsString()
  @MaxLength(1024)
  refreshToken!: string;
}

export class RequestOtpDto {
  /** Phone or email the code is sent to. */
  @IsString()
  @MinLength(6)
  @MaxLength(255)
  target!: string;

  @IsEnum(otp_purpose)
  purpose!: otp_purpose;
}

export class VerifyOtpDto {
  @IsString()
  @MinLength(6)
  @MaxLength(255)
  target!: string;

  @IsEnum(otp_purpose)
  purpose!: otp_purpose;

  @IsString()
  @MinLength(4)
  @MaxLength(10)
  code!: string;
}

export class RequestPasswordResetDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MaxLength(255)
  token!: string;

  @IsString()
  @MinLength(8, { message: 'ລະຫັດຜ່ານຢ່າງໜ້ອຍ 8 ຕົວອັກສອນ · Minimum 8 characters' })
  @MaxLength(128)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
