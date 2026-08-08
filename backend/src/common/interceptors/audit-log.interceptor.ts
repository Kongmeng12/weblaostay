import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUDIT_KEY, type AuditMeta, type AuthedUser } from '../decorators';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Writes an `audit_logs` row for any route carrying @Audit(...), after the
 * handler succeeds. A failed call is not logged as an action — a 403 is not an
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
        const user: AuthedUser | undefined = req.user;

        void this.prisma.audit_logs
          .create({
            data: {
              // Null is meaningful: the hold sweeper and the payout generator
              // act with no user behind them.
              user_id: user?.userId ?? null,
              action: meta.action,
              module_name: meta.module ?? null,
              table_name: meta.table ?? null,
              record_id: recordId(req.params, meta.recordParam),
              ip_address: clientIp(req),
              user_agent: typeof req.headers['user-agent'] === 'string'
                ? req.headers['user-agent'].slice(0, 500)
                : null,
            },
          })
          .catch((err: Error) =>
            this.logger.error(`audit write failed for "${meta.action}": ${err.message}`),
          );
      }),
    );
  }
}

/** Route params are strings; the column is bigint. Anything unparseable is null. */
function recordId(params: Record<string, string> | undefined, key: string | undefined): bigint | null {
  const raw = key ? params?.[key] : undefined;
  if (!raw || !/^\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function clientIp(req: {
  headers: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
