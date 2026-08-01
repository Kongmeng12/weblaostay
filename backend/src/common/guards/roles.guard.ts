import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators';
import type { Role } from '../roles';
import { ACTOR } from '../actors';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @Roles() on the route means any authenticated caller may call it.
    if (!required?.length) return true;

    const { user } = context.switchToHttp().getRequest();

    // Roles are an admin concept. A partner or customer token reaching a
    // @Roles() route means the route is mis-decorated — refuse rather than fall
    // through to the role comparison, where `undefined` would simply not match.
    if (user?.actorType !== ACTOR.ADMIN) {
      throw new ForbiddenException('ສິດບໍ່ພຽງພໍ · Admin access required');
    }

    if (!user?.role || !required.includes(user.role)) {
      throw new ForbiddenException(
        `ສິດບໍ່ພຽງພໍ · requires one of: ${required.join(', ')}`,
      );
    }
    return true;
  }
}
