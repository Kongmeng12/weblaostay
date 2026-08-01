import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ALL_ROLES, ROLE, type Role } from '../../common/roles';
import { PROPERTY_TYPES } from '../../common/money';

export class LoginDto {
  @IsEmail({}, { message: 'ອີເມວບໍ່ຖືກຕ້ອງ · Invalid email' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'ລະຫັດຜ່ານຢ່າງໜ້ອຍ 8 ຕົວອັກສອນ · Minimum 8 characters' })
  @MaxLength(128)
  password!: string;
}

export class RegisterAdminDto {
  @IsEmail({}, { message: 'ອີເມວບໍ່ຖືກຕ້ອງ · Invalid email' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @IsString()
  @MinLength(8, { message: 'ລະຫັດຜ່ານຢ່າງໜ້ອຍ 8 ຕົວອັກສອນ · Minimum 8 characters' })
  @MaxLength(128)
  password!: string;

  @IsIn(ALL_ROLES, { message: `role ຕ້ອງເປັນ: ${ALL_ROLES.join(' | ')}` })
  role: Role = ROLE.STAFF;
}

/**
 * A partner signs up with their account details *and* their first property —
 * an application with no property is nothing for the Approvals screen to judge.
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
  propertyName!: string;

  @IsIn(PROPERTY_TYPES, { message: `ປະເພດທີ່ພັກຕ້ອງເປັນ: ${PROPERTY_TYPES.join(' | ')}` })
  propertyType!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  province!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(500)
  address!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankAccount?: string;
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
  @MinLength(6)
  @MaxLength(50)
  phone!: string;
}

export class RefreshDto {
  @IsString()
  @MaxLength(1024)
  refreshToken!: string;
}
