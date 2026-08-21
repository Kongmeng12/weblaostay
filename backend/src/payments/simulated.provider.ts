import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { buildQrPayload } from './emvco';
import type {
  CallbackResult,
  ChargeRequest,
  ChargeResult,
  PaymentProvider,
} from './payment-provider.interface';

/**
 * Development stand-in for PhaJay.
 *
 * It produces a real, well-formed EMVCo payload — so the app renders a genuine
 * QR and any parsing bug shows up here rather than in production — but no bank
 * is involved. Settlement is triggered by `POST /payments/dev/settle/:id`,
 * which signs a callback with the same HMAC scheme the real webhook uses, so
 * the settlement path under test is the production one.
 */
@Injectable()
export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = 'simulated';
  private readonly logger = new Logger(SimulatedPaymentProvider.name);

  constructor(private readonly config: ConfigService) {}

  createCharge(request: ChargeRequest): Promise<ChargeResult> {
    const ttlMin = Number(this.config.get<string>('PHAJAY_QR_TTL_MIN', '15'));

    const qrPayload = buildQrPayload({
      acquirerId: 'la.phajay.sim',
      merchantId: this.config.get<string>('PHAJAY_MERCHANT_ID', 'SIMULATED-MERCHANT'),
      merchantName: 'PhaPhak',
      merchantCity: 'Vientiane',
      amountKip: request.amountKip,
      reference: request.reference,
    });

    this.logger.warn(
      `Simulated payment for booking ${request.bookingId} — no bank involved. ` +
        `Settle it with POST /api/payments/dev/settle/:paymentId`,
    );

    return Promise.resolve({
      qrPayload,
      // No bank app to hand off to when nothing is real.
      deepLink: null,
      providerRef: 'SIM-' + randomBytes(8).toString('hex').toUpperCase(),
      expiresAt: new Date(Date.now() + ttlMin * 60_000),
    });
  }

  verifyCallback(rawBody: Buffer, headers: Record<string, unknown>): CallbackResult {
    return verifyHmacCallback(rawBody, headers, this.webhookSecret());
  }

  /** Used by the dev settle endpoint to sign a body the webhook will accept. */
  sign(rawBody: Buffer): string {
    return createHmac('sha256', this.webhookSecret()).update(rawBody).digest('hex');
  }

  private webhookSecret(): string {
    // Falls back to a fixed development secret so a fresh clone works without
    // any configuration; production runs the real provider, which requires one.
    return this.config.get<string>('PHAJAY_WEBHOOK_SECRET') || 'phaphak-dev-webhook-secret';
  }
}

/**
 * Shared HMAC callback verification.
 *
 * `timingSafeEqual` rather than `===`: comparing signatures byte by byte with
 * an early exit leaks, one character at a time, what the correct signature is.
 */
export function verifyHmacCallback(
  rawBody: Buffer,
  headers: Record<string, unknown>,
  secret: string,
): CallbackResult {
  const provided = headerValue(headers, 'x-phajay-signature');
  if (!provided) {
    return { ok: false, reference: null, txnRef: null, amountKip: null, status: null, reason: 'missing signature' };
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reference: null, txnRef: null, amountKip: null, status: null, reason: 'bad signature' };
  }

  let body: {
    reference?: string;
    txnRef?: string;
    amount?: number;
    status?: string;
  };
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { ok: false, reference: null, txnRef: null, amountKip: null, status: null, reason: 'body is not JSON' };
  }

  return {
    ok: true,
    reference: body.reference ?? null,
    txnRef: body.txnRef ?? null,
    amountKip: typeof body.amount === 'number' ? body.amount : null,
    status: body.status ?? null,
  };
}

function headerValue(headers: Record<string, unknown>, name: string): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}
