import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators';
import type { Role } from '../roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @Roles() on the route means any authenticated admin may call it.
    if (!required?.length) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.role || !required.includes(user.role)) {
      throw new ForbiddenException(
        `ສິດບໍ່ພຽງພໍ · requires one of: ${required.join(', ')}`,
      );
    }
    return true;
  }
}
