import { Injectable, ExecutionContext, CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY, ACTOR_KEY } from '../decorators';
import { ACTOR, STRATEGY, type ActorType } from '../actors';

/**
 * Applied globally in AppModule, so every route needs a valid access token
 * unless it opts out with @Public(). Forgetting a guard therefore fails closed.
 *
 * Which token counts depends on @Actor() — no decorator means `admin`, which is
 * what every route written before partners existed expects.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  /**
   * One guard instance per strategy, built once. AuthGuard() returns a mixin
   * class, so instantiating it per request would allocate a class per call.
   */
  private readonly guards = new Map<ActorType, CanActivate>(
    (Object.values(ACTOR) as ActorType[]).map((actor) => {
      const Guard = AuthGuard(STRATEGY[actor]);
      return [actor, new Guard() as CanActivate];
    }),
  );

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const actor =
      this.reflector.getAllAndOverride<ActorType>(ACTOR_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? ACTOR.ADMIN;

    return this.guards.get(actor)!.canActivate(context);
  }
}
