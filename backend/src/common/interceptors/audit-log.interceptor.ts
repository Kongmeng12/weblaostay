import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUDIT_KEY, type AuditMeta, type AuthedUser } from '../decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * Writes an `audit_logs` row for any route carrying @Audit(...), after the
 * handler succeeds. A failed call is not logged as an action — a 403 is not an
 * approval.
 *
 * Writing is fire-and-forget: an audit failure must never turn a successful
 * payout into a 500 for the caller. Failures are logged loudly instead.
 *
 * ## What changed
 *
 * This runs *after* the handler, so by the time it sees the request the old
 * value is already gone. Anything that wants "was X, now Y" in the log has to
 * say so itself, by calling `recordChange(req, old, next)` before it writes.
 * Without that the row still records who did what to which row — which is what
 * the 15 existing routes have always done — but not what the values were.
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

    // Express's own Request type is not imported here on purpose: this only
    // needs the four things it reads, and naming them keeps the interceptor
    // usable from any transport.
    const req: {
      auditChange?: AuditChange;
      user?: AuthedUser;
      params?: Record<string, string>;
      headers: Record<string, unknown>;
      ip?: string;
      socket?: { remoteAddress?: string };
    } = context.switchToHttp().getRequest();

    return next.handle().pipe(
      tap(() => {
        const user = req.user;

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
              // Set by the service, if it bothered to. `null` rather than `{}`
              // so "nobody recorded this" reads differently from "nothing
              // changed".
              old_values: json(req.auditChange?.old),
              new_values: json(req.auditChange?.next),
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

/**
 * A plain object as something Prisma will write to a `Json?` column.
 *
 * `Prisma.JsonNull` rather than `null` or `undefined`: `undefined` means "leave
 * the column alone" and `null` is not accepted for a nullable Json field, so
 * the explicit sentinel is the only way to store a real SQL NULL.
 */
function json(value: Record<string, unknown> | null | undefined) {
  return value ? (value as Prisma.InputJsonValue) : Prisma.JsonNull;
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

/**
 * The values a route changed, for whichever @Audit row is about to be written.
 *
 * Parked on the request because the interceptor runs after the handler and has
 * no other way to hear about it. A service that does not call this still gets
 * an audit row — just one that says what happened without saying to what.
 *
 * Pass only the fields that moved. A whole entity in here is noise, and for
 * some tables it is a way to copy a password hash into a log.
 */
export function recordChange(
  req: unknown,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): void {
  (req as { auditChange?: AuditChange }).auditChange = { old, next };
}

export interface AuditChange {
  old: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
}
