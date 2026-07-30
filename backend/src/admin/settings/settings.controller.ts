import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SettingsService } from '../../common/settings.service';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Audit, CurrentAdmin, Roles, type AuthedAdmin } from '../../common/decorators';
import { ALL_ROLES, MONEY_ROLES, ROLE, ROLE_LABEL, type Role } from '../../common/roles';

class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  platform_name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  contact_email?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commission_rate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  walkin_commission_rate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  cancellation_fee_rate?: number;
}

class CreateAdminDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsIn(ALL_ROLES)
  role!: Role;
}

class UpdateAdminRoleDto {
  @IsIn(ALL_ROLES)
  role!: Role;
}

class AuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;
}

@Controller('admin/settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  get() {
    return this.settings.get();
  }

  /** Commission and cancellation rates are money levers — finance and above. */
  @Put()
  @Roles(...MONEY_ROLES)
  @Audit('settings_update')
  update(@Body() dto: UpdateSettingsDto, @CurrentAdmin() admin: AuthedAdmin) {
    return this.settings.update(dto, admin.id);
  }

  @Get('admins')
  async admins() {
    const rows = await this.prisma.admins.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, email: true, name: true, role: true, last_login_at: true },
    });
    return rows.map((a) => ({ ...a, roleLabel: ROLE_LABEL[a.role as Role] ?? a.role }));
  }

  @Post('admins')
  @Roles(ROLE.SUPER_ADMIN)
  @Audit('admin_create')
  createAdmin(@Body() dto: CreateAdminDto) {
    return this.auth.createAdmin(dto);
  }

  @Patch('admins/:id/role')
  @Roles(ROLE.SUPER_ADMIN)
  @Audit('admin_role_change', 'admins:id')
  async setRole(
    @Param('id') id: string,
    @Body() dto: UpdateAdminRoleDto,
    @CurrentAdmin() actor: AuthedAdmin,
  ) {
    const targetId = BigInt(id);

    // Demoting yourself could leave the platform with no super_admin at all.
    if (targetId === actor.id && dto.role !== ROLE.SUPER_ADMIN) {
      throw new ForbiddenException(
        'ປ່ຽນສິດຕົນເອງລົງບໍ່ໄດ້ · You cannot remove your own super_admin role',
      );
    }

    await this.assertNotLastSuperAdmin(targetId, dto.role);

    return this.prisma.admins.update({
      where: { id: targetId },
      data: { role: dto.role },
      select: { id: true, email: true, name: true, role: true },
    });
  }

  @Delete('admins/:id')
  @Roles(ROLE.SUPER_ADMIN)
  @Audit('admin_delete', 'admins:id')
  async deleteAdmin(@Param('id') id: string, @CurrentAdmin() actor: AuthedAdmin) {
    const targetId = BigInt(id);
    if (targetId === actor.id) {
      throw new ForbiddenException('ລຶບບັນຊີຕົນເອງບໍ່ໄດ້ · You cannot delete your own account');
    }
    await this.assertNotLastSuperAdmin(targetId, null);

    await this.prisma.admins.delete({ where: { id: targetId } });
    return { deleted: true, id };
  }

  @Get('audit-logs')
  async auditLogs(@Query() query: AuditQueryDto) {
    const where = query.action ? { action: query.action } : {};
    const [rows, total] = await Promise.all([
      this.prisma.audit_logs.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.audit_logs.count({ where }),
    ]);

    // Resolve admin ids to names so the log reads as prose, not numbers.
    const adminIds = [...new Set(rows.filter((r) => r.actor_type === 'admin').map((r) => r.actor_id))];
    const admins = adminIds.length
      ? await this.prisma.admins.findMany({
          where: { id: { in: adminIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const byId = new Map(admins.map((a) => [a.id.toString(), a]));

    return {
      items: rows.map((r) => ({
        ...r,
        actorName: byId.get(r.actor_id.toString())?.name ?? `#${r.actor_id}`,
        actorEmail: byId.get(r.actor_id.toString())?.email ?? null,
      })),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  /** Refuses any change that would remove the final super_admin. */
  private async assertNotLastSuperAdmin(targetId: bigint, newRole: Role | null) {
    const target = await this.prisma.admins.findUnique({
      where: { id: targetId },
      select: { role: true },
    });
    if (!target || target.role !== ROLE.SUPER_ADMIN) return;
    if (newRole === ROLE.SUPER_ADMIN) return;

    const superAdmins = await this.prisma.admins.count({ where: { role: ROLE.SUPER_ADMIN } });
    if (superAdmins <= 1) {
      throw new ForbiddenException(
        'ຕ້ອງມີ super_admin ຢ່າງໜ້ອຍ 1 ຄົນ · At least one super_admin must remain',
      );
    }
  }
}
