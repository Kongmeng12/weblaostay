import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { admin_role, user_role } from '@prisma/client';

/** Marks a route as reachable without a token (login, search, webhooks). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Which `users.role` may call this route.
 *
 * v1 needed three passport strategies because admins, partners and customers
 * lived in three tables. v2 has one `users` table with a role column, so a
 * single strategy authenticates and this decorator authorises.
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: user_role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Narrows further, for admins only: which `users.admin_role` may call this.
 * Used on the money routes, where staff must be refused.
 */
export const ADMIN_ROLES_KEY = 'adminRoles';
export const AdminRoles = (...roles: admin_role[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

/**
 * Records the call in `audit_logs` when it succeeds.
 *
 * v2's audit table carries the module and the row touched, not just a free-text
 * target, so the decorator takes them: @Audit('payout_pay', 'finance', 'payouts', 'id').
 * `recordParam` names the route param holding the row id.
 */
export const AUDIT_KEY = 'audit';
export interface AuditMeta {
  action: string;
  module?: string;
  table?: string;
  recordParam?: string;
}
export const Audit = (action: string, module?: string, table?: string, recordParam = 'id') =>
  SetMetadata(AUDIT_KEY, { action, module, table, recordParam } satisfies AuditMeta);

/**
 * The authenticated caller, as every route sees it.
 *
 * `partnerId` is resolved at authentication time rather than looked up per
 * request: almost every partner route needs it, and joining it once here means
 * no service has to remember that `users.user_id` is not `partners.partner_id`.
 */
export interface AuthedUser {
  userId: bigint;
  email: string;
  role: user_role;
  adminRole: admin_role | null;
  /** Set only when role = PARTNER. */
  partnerId: bigint | null;
  fullName: string | null;
  isVerified: boolean;
}

export const CurrentUser = createParamDecorator(
  (field: keyof AuthedUser | undefined, ctx: ExecutionContext): AuthedUser | unknown => {
    const req = ctx.switchToHttp().getRequest();
    const user: AuthedUser = req.user;
    return field ? user?.[field] : user;
  },
);

/** Client IP, honouring the proxy header Neon/Vercel style hosts set. */
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
});

/** The browser or app string, recorded on sessions and login attempts. */
export const UserAgent = createParamDecorator((_: unknown, ctx: ExecutionContext): string | null => {
  const ua = ctx.switchToHttp().getRequest().headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 500) : null;
});
