import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '../roles';
import { ACTOR, type ActorType } from '../actors';

/** Marks a route as reachable without a token (login, refresh, health). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Which table the caller's token must belong to. Read by JwtAuthGuard to pick
 * the passport strategy. Omitting it means `admin`, so every route written
 * before partners existed keeps its original behaviour.
 */
export const ACTOR_KEY = 'actorType';
export const Actor = (actor: ActorType) => SetMetadata(ACTOR_KEY, actor);

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
  actorType: typeof ACTOR.ADMIN;
  id: bigint;
  email: string;
  name: string;
  role: Role;
}

export interface AuthedPartner {
  actorType: typeof ACTOR.PARTNER;
  id: bigint;
  email: string;
  ownerName: string;
  status: string;
}

export interface AuthedUser {
  actorType: typeof ACTOR.USER;
  id: bigint;
  email: string;
  fullName: string;
  status: string;
}

export type AuthedActor = AuthedAdmin | AuthedPartner | AuthedUser;

/** Injects the admin decoded from the access token. */
export const CurrentAdmin = createParamDecorator(
  (field: keyof AuthedAdmin | undefined, ctx: ExecutionContext): AuthedAdmin | unknown => {
    const req = ctx.switchToHttp().getRequest();
    const admin: AuthedAdmin = req.user;
    return field ? admin?.[field] : admin;
  },
);

/** Injects the partner decoded from the access token. */
export const CurrentPartner = createParamDecorator(
  (field: keyof AuthedPartner | undefined, ctx: ExecutionContext): AuthedPartner | unknown => {
    const req = ctx.switchToHttp().getRequest();
    const partner: AuthedPartner = req.user;
    return field ? partner?.[field] : partner;
  },
);

/** Injects the customer decoded from the access token. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthedUser | undefined, ctx: ExecutionContext): AuthedUser | unknown => {
    const req = ctx.switchToHttp().getRequest();
    const user: AuthedUser = req.user;
    return field ? user?.[field] : user;
  },
);

/**
 * Whoever is calling, without narrowing to one actor. Used by the shared chat
 * and notification services, which serve all three.
 */
export const CurrentActor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthedActor => ctx.switchToHttp().getRequest().user,
);

/** Client IP, honouring the proxy header Neon/Vercel style hosts set. */
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
});
