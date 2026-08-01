import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUDIT_KEY, AuditMeta } from '../decorators';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Writes an `audit_logs` row for any route carrying @Audit(...), after the
 * handler succeeds. Failed calls are not logged as actions — a 403 is not an
 * approval.
 *
 * Writing is fire-and-forget: an audit failure must never turn a successful
 * payout into a 500 for the caller. Failures are logged loudly instead.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditMeta>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest();

    return next.handle().pipe(
      tap(() => {
        const actor = req.user;
        if (!actor?.id) return;

        void this.prisma.audit_logs
          .create({
            data: {
              actor_type: actor.actorType ?? 'admin',
              actor_id: BigInt(actor.id),
              action: meta.action,
              target: resolveTarget(meta.target, req.params),
              ip_address: clientIp(req),
            },
          })
          .catch((err: Error) =>
            this.logger.error(`audit write failed for "${meta.action}": ${err.message}`),
          );
      }),
    );
  }
}

/** Fills `:param` placeholders, e.g. "partners:id" + {id:"7"} -> "partners:7". */
function resolveTarget(template: string | undefined, params: Record<string, string>): string | null {
  if (!template) return null;
  return template.replace(/:(\w+)/g, (_, name: string) => params?.[name] ?? `:${name}`);
}

function clientIp(req: { headers: Record<string, unknown>; ip?: string; socket?: { remoteAddress?: string } }): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
