import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Every primary key in this database is `int8`, which Prisma hands back as a
 * JavaScript BigInt — and `JSON.stringify` throws on BigInt.
 *
 * Rather than monkey-patching `BigInt.prototype.toJSON` (which changes the
 * global for every library in the process), responses are walked once on the
 * way out and BigInts are converted to strings. Prisma `Decimal` values get the
 * same treatment so `commission_rate` arrives as "5" and not `{s,e,d}`.
 */
function serialize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;

  // Prisma Decimal and anything else that knows how to render itself
  const maybeDecimal = value as { constructor?: { name?: string }; toString(): string };
  if (maybeDecimal.constructor?.name === 'Decimal') return maybeDecimal.toString();

  if (seen.has(value as object)) return undefined;
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((v) => serialize(v, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = serialize(v, seen);
  }
  return out;
}

@Injectable()
export class BigIntInterceptor implements NestInterceptor {
  intercept(_: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => serialize(data)));
  }
}
