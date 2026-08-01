import { UnauthorizedException } from '@nestjs/common';
import type { ActorType } from '../../common/actors';

export interface AccessTokenPayload {
  /** Row id as a string — BigInt does not survive JSON. */
  sub: string;
  /** Which table `sub` refers to. */
  typ: ActorType;
  email: string;
  /** Admins only. */
  role?: string;
}

/**
 * All three actors' tokens are signed with the same secret, so signature
 * validity alone does not say *which* table the caller belongs to. Every
 * strategy calls this first: without it, a partner's access token would sail
 * through the admin strategy's signature check and only fail later — or not at
 * all, if the ids happened to line up.
 */
export function assertActorType(payload: AccessTokenPayload, expected: ActorType): void {
  if (payload?.typ !== expected) {
    throw new UnauthorizedException('Token ບໍ່ຖືກປະເພດ · Wrong token type for this endpoint');
  }
}
