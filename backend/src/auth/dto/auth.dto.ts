import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { ALL_ROLES, ROLE, type Role } from '../../common/roles';

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

export class RefreshDto {
  @IsString()
  @MaxLength(1024)
  refreshToken!: string;
}
