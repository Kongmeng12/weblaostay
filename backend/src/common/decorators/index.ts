import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '../roles';

/** Marks a route as reachable without a token (login, refresh, health). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to the given admin roles. Enforced by RolesGuard. */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Records the call in `audit_logs` when it succeeds.
 * `target` may contain `:param` placeholders filled from route params,
 * e.g. @Audit('approve_partner', 'partners:id').
 */
export const AUDIT_KEY = 'audit';
export interface AuditMeta {
  action: string;
  target?: string;
}
export const Audit = (action: string, target?: string) =>
  SetMetadata(AUDIT_KEY, { action, target } satisfies AuditMeta);

export interface AuthedAdmin {
  id: bigint;
  email: string;
  name: string;
  role: Role;
}

/** Injects the admin decoded from the access token. */
export const CurrentAdmin = createParamDecorator(
  (field: keyof AuthedAdmin | undefined, ctx: ExecutionContext): AuthedAdmin | unknown => {
    const req = ctx.switchToHttp().getRequest();
    const admin: AuthedAdmin = req.user;
    return field ? admin?.[field] : admin;
  },
);

/** Client IP, honouring the proxy header Neon/Vercel style hosts set. */
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
});
