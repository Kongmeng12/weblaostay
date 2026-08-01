import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { buildQrPayload } from './emvco';
import { verifyHmacCallback } from './simulated.provider';
import type {
  CallbackResult,
  ChargeRequest,
  ChargeResult,
  PaymentProvider,
} from './payment-provider.interface';

/**
 * The real PhaJay / LAPNet adapter.
 *
 * **This file is the only place to change when the acquirer's spec arrives.**
 * Everything it needs comes from `PHAJAY_*` in `.env`; nothing else in the
 * codebase knows the provider exists. Two things are almost certainly
 * acquirer-specific and should be checked against the spec before going live:
 *
 *  1. `createCharge` — whether the QR is minted locally from the merchant id
 *     (implemented here) or fetched from the acquirer's API. If it is fetched,
 *     replace the body of `createCharge` with the HTTP call; the signature and
 *     the return type stay the same.
 *  2. `verifyCallback` — the header name and signing scheme. This assumes
 *     `x-phajay-signature: <hex HMAC-SHA256 of the raw body>` using
 *     `PHAJAY_WEBHOOK_SECRET`.
 *
 * Until `PHAJAY_MERCHANT_ID` is set the provider refuses to mint a QR rather
 * than producing one that would silently fail at the bank.
 */
@Injectable()
export class PhaJayPaymentProvider implements PaymentProvider {
  readonly name = 'phajay';
  private readonly logger = new Logger(PhaJayPaymentProvider.name);

  constructor(private readonly config: ConfigService) {}

  async createCharge(request: ChargeRequest): Promise<ChargeResult> {
    const merchantId = this.required('PHAJAY_MERCHANT_ID');
    const acquirerId = this.config.get<string>('PHAJAY_ACQUIRER_ID', 'la.lapnet.phajay');
    const ttlMin = Number(this.config.get<string>('PHAJAY_QR_TTL_MIN', '15'));
    const baseUrl = this.config.get<string>('PHAJAY_BASE_URL', '');

    const expiresAt = new Date(Date.now() + ttlMin * 60_000);

    // Locally-minted static-merchant QR with a dynamic amount. If the acquirer
    // requires a server-registered charge, do it here and use the payload and
    // reference it returns instead.
    const qrPayload = buildQrPayload({
      acquirerId,
      merchantId,
      merchantName: this.config.get<string>('PHAJAY_MERCHANT_NAME', 'LaoStay'),
      merchantCity: this.config.get<string>('PHAJAY_MERCHANT_CITY', 'Vientiane'),
      amountKip: request.amountKip,
      reference: request.reference,
    });

    if (!baseUrl) {
      // No registration endpoint configured: the QR still works for a merchant
      // whose acquirer reconciles by reference, but nothing has been told about
      // this charge in advance, so say so loudly.
      this.logger.warn(
        'PHAJAY_BASE_URL is not set — the QR was minted locally and no charge ' +
          'was registered with the acquirer.',
      );
      return { qrPayload, providerRef: null, expiresAt };
    }

    const providerRef = await this.registerCharge(baseUrl, request, expiresAt);
    return { qrPayload, providerRef, expiresAt };
  }

  verifyCallback(rawBody: Buffer, headers: Record<string, unknown>): CallbackResult {
    const secret = this.config.get<string>('PHAJAY_WEBHOOK_SECRET');
    if (!secret) {
      // Refuse rather than accept unverified money movement.
      this.logger.error('PHAJAY_WEBHOOK_SECRET is not set; rejecting the callback');
      return {
        ok: false,
        reference: null,
        txnRef: null,
        amountKip: null,
        status: null,
        reason: 'webhook secret not configured',
      };
    }
    return verifyHmacCallback(rawBody, headers, secret);
  }

  /**
   * Tells the acquirer a charge is coming, so its callback can be matched.
   * Shape guessed from the usual pattern — confirm against the spec.
   */
  private async registerCharge(
    baseUrl: string,
    request: ChargeRequest,
    expiresAt: Date,
  ): Promise<string | null> {
    const body = JSON.stringify({
      merchantId: this.required('PHAJAY_MERCHANT_ID'),
      amount: request.amountKip,
      currency: 'LAK',
      reference: request.reference,
      description: request.description,
      expiresAt: expiresAt.toISOString(),
    });

    const apiKey = this.config.get<string>('PHAJAY_API_KEY', '');
    const secret = this.config.get<string>('PHAJAY_SECRET', '');
    const signature = secret ? createHmac('sha256', secret).update(body).digest('hex') : '';

    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/qr/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
          ...(signature ? { 'x-phajay-signature': signature } : {}),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${res.status} ${text.slice(0, 200)}`);
      }

      const json = (await res.json()) as { txnRef?: string; id?: string };
      return json.txnRef ?? json.id ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`PhaJay charge registration failed: ${message}`);
      throw new ServiceUnavailableException(
        'ລະບົບຊຳລະບໍ່ຕອບສະໜອງ ກະລຸນາລອງໃໝ່ · The payment service is unavailable, please try again',
      );
    }
  }

  private required(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new ServiceUnavailableException(
        `${key} ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ · ${key} is not configured; set it in backend/.env ` +
          'or run with PAYMENT_PROVIDER=simulated',
      );
    }
    return value;
  }
}
