import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { user_role, type admin_role } from '@prisma/client';
import { ADMIN_ROLES_KEY, ROLES_KEY, type AuthedUser } from '../decorators';
import { ADMIN_ROLE_LABEL } from '../enums';

/**
 * Authorises what JwtAuthGuard authenticated.
 *
 * Two levels, because v2 has two: `role` says which kind of account this is,
 * and `admin_role` says what an admin may do. The money routes carry both —
 * `@Roles(ADMIN)` and `@AdminRoles(super_admin, finance)` — so a staff account
 * is refused at the payout endpoints rather than merely hidden from them.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<user_role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAdminRoles = this.reflector.getAllAndOverride<admin_role[]>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Neither decorator means any authenticated caller may proceed.
    if (!requiredRoles?.length && !requiredAdminRoles?.length) return true;

    const user: AuthedUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('ຕ້ອງເຂົ້າສູ່ລະບົບກ່ອນ · Authentication required');

    if (requiredRoles?.length && !requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `ສິດບໍ່ພຽງພໍ · requires one of: ${requiredRoles.join(', ')}`,
      );
    }

    if (requiredAdminRoles?.length) {
      // An admin-role requirement implies an admin, even if @Roles was omitted.
      if (user.role !== user_role.ADMIN || user.adminRole === null) {
        throw new ForbiddenException('ສິດບໍ່ພຽງພໍ · Admin access required');
      }
      if (!requiredAdminRoles.includes(user.adminRole)) {
        const labels = requiredAdminRoles.map((r) => ADMIN_ROLE_LABEL[r]).join(', ');
        throw new ForbiddenException(`ສິດບໍ່ພຽງພໍ · requires: ${labels}`);
      }
    }

    return true;
  }
}
