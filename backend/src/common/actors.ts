/**
 * The three kinds of caller this API serves.
 *
 * `admins`, `partners` and `users` are separate tables with separate login
 * endpoints, so "who is calling" is a different question from "what role does
 * this admin have" (see roles.ts). Every authenticated request ends up with one
 * of the `Authed*` shapes below on `req.user`, tagged with `actorType`.
 */
export const ACTOR = {
  ADMIN: 'admin',
  PARTNER: 'partner',
  USER: 'user',
} as const;

export type ActorType = (typeof ACTOR)[keyof typeof ACTOR];

/**
 * Passport strategy registered for each actor. All three verify against the
 * same JWT_ACCESS_SECRET, so the `typ` claim — checked inside every strategy —
 * is what stops a partner token from being accepted on an admin route.
 */
export const STRATEGY: Record<ActorType, string> = {
  [ACTOR.ADMIN]: 'jwt',
  [ACTOR.PARTNER]: 'jwt-partner',
  [ACTOR.USER]: 'jwt-user',
};

/** `notifications.recipient_type` / `audit_logs.actor_type` use these strings. */
export const RECIPIENT = ACTOR;
