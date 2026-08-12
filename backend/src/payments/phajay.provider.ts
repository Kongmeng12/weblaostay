import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CallbackResult,
  ChargeRequest,
  ChargeResult,
  PaymentProvider,
} from './payment-provider.interface';

/** PhaJay's gateway. Overridable so a sandbox host can be pointed at instead. */
const DEFAULT_BASE_URL = 'https://payment-gateway.phajay.co';

/** The one callback status that means the money arrived. */
const COMPLETED = 'PAYMENT_COMPLETED';

/**
 * The banks PhaJay can mint a QR for, and the path segment for each.
 *
 * There is one endpoint per bank because the QR is not interchangeable — a
 * BCEL payload carries `0004BCEL0106ONEPAY` and is read by the BCEL app. So a
 * guest is shown the QR for whichever bank `PHAJAY_BANK` names.
 */
const BANKS = {
  bcel: 'generate-bcel-qr',
  jdb: 'generate-jdb-qr',
  ldb: 'generate-ldb-qr',
  ib: 'generate-ib-qr',
  stb: 'generate-stb-qr',
  m_money: 'generate-m-money-qr',
} as const;

type Bank = keyof typeof BANKS;

/**
 * PhaJay — Generate QR.
 *
 * The guest scans and pays; there is no page to open and no bank to choose on
 * the way. PhaJay returns the EMVCo string ready to draw, so every client that
 * already renders a QR keeps working untouched.
 *
 * PhaJay also offers a hosted **Payment Link** where the guest picks their bank
 * on PhaJay's own page. That is the right choice if you want every bank from
 * one charge; it costs the guest two extra taps, which is why this uses the
 * direct QR instead.
 *
 * The sandbox mirrors the live API one path segment along and settles without
 * moving money, so it is used unless `NODE_ENV=production`. There is no flag to
 * get wrong: a development machine cannot reach the live endpoints at all.
 *
 * ## The webhook is not signed
 *
 * PhaJay's callback carries no HMAC, so nothing in the body proves who sent it.
 * `verifyCallback` therefore only *parses* — the callback is authenticated by
 * the secret in its URL, checked before this is ever called, and settlement
 * additionally refuses anything that does not name a still-pending payment for
 * the amount charged.
 */
@Injectable()
export class PhaJayPaymentProvider implements PaymentProvider {
  readonly name = 'phajay';
  private readonly logger = new Logger(PhaJayPaymentProvider.name);

  constructor(private readonly config: ConfigService) {}

  async createCharge(request: ChargeRequest): Promise<ChargeResult> {
    const secretKey = this.required('PHAJAY_API_KEY');
    const bank = this.bank();
    const baseUrl = this.optional('PHAJAY_BASE_URL', DEFAULT_BASE_URL).replace(/\/+$/, '');
    const ttlMin = Number(this.optional('PHAJAY_QR_TTL_MIN', '15'));
    // The sandbox is the same API one path segment along, and moves no money.
    const live = this.config.get<string>('NODE_ENV') === 'production';
    const segment = live ? 'payment' : 'test/payment';

    const body = JSON.stringify({
      amount: request.amountKip,
      description: this.describe(request.description, bank),
      // Echoed back on the webhook. `tag1` carries our own reference, which is
      // what settlement matches on — PhaJay's QR call has no orderNo field.
      tag1: request.reference,
      tag2: request.bookingId.toString(),
    });

    let json: { message?: string; transactionId?: string; qrCode?: string; link?: string };
    try {
      const res = await fetch(`${baseUrl}/v1/api/${segment}/${BANKS[bank]}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // A bare header, not Basic auth — PhaJay's QR endpoints differ from
          // their Payment Link endpoint on this.
          secretKey,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
      json = JSON.parse(text) as typeof json;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`PhaJay ${bank} QR request failed: ${message}`);
      throw new ServiceUnavailableException(
        'ລະບົບຊຳລະບໍ່ຕອບສະໜອງ ກະລຸນາລອງໃໝ່ · The payment service is unavailable, please try again',
      );
    }

    if (!json.qrCode) {
      this.logger.error(`PhaJay returned no qrCode: ${JSON.stringify(json).slice(0, 200)}`);
      throw new ServiceUnavailableException(
        'ສ້າງ QR ບໍ່ໄດ້ ກະລຸນາລອງໃໝ່ · Could not create the payment QR, please try again',
      );
    }

    return {
      qrPayload: json.qrCode,
      deepLink: json.link ?? null,
      providerRef: json.transactionId ?? null,
      expiresAt: new Date(Date.now() + ttlMin * 60_000),
    };
  }

  /**
   * Reads the callback. Whether to act on it is decided by the caller — see
   * the note on this class.
   */
  verifyCallback(rawBody: Buffer, _headers: Record<string, unknown>): CallbackResult {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      return { ...empty(), reason: 'callback body is not JSON' };
    }

    const status = str(body.status);
    // `tag1` is where createCharge put our reference. `orderNo` is PhaJay's own
    // field, present on the Payment Link flow — accepted so a charge created
    // either way settles through the same path.
    const reference = str(body.tag1) ?? str(body.orderNo);
    if (!reference) return { ...empty(), reason: 'callback carries no reference' };

    return {
      ok: true,
      reference,
      txnRef: str(body.transactionId) ?? str(body.linkCode) ?? str(body.paymentId),
      amountKip: num(body.txnAmount),
      status: status === COMPLETED ? 'paid' : 'failed',
      ...(status !== COMPLETED && { reason: `PhaJay reported ${status ?? 'no status'}` }),
    };
  }

  private bank(): Bank {
    const choice = this.optional('PHAJAY_BANK', 'bcel')
      .toLowerCase()
      .replace(/[^a-z_]/g, '');
    if (choice in BANKS) return choice as Bank;

    throw new ServiceUnavailableException(
      `PHAJAY_BANK="${choice}" ບໍ່ຮູ້ຈັກ · unknown bank; use one of ${Object.keys(BANKS).join(', ')}`,
    );
  }

  /**
   * The line the payer sees in their banking app.
   *
   * BCEL rejects Lao and Thai characters, and a property name is usually Lao,
   * so the text is reduced to ASCII for it. The booking code survives, which is
   * the part that matters on a bank statement.
   */
  private describe(description: string, bank: Bank): string {
    if (bank !== 'bcel') return description;

    const ascii = description.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
    return ascii || 'LaoStay booking';
  }

  /**
   * A setting, or the fallback when it is absent **or blank**.
   *
   * `ConfigService.get(key, fallback)` only falls back on `undefined`, and a
   * `.env` that lists a key with nothing after the `=` gives an empty string.
   * That is how `PHAJAY_BASE_URL=` turned into a request to the empty host.
   */
  private optional(key: string, fallback: string): string {
    const value = this.config.get<string>(key);
    return value !== undefined && value.trim() !== '' ? value.trim() : fallback;
  }

  private required(key: string): string {
    const value = this.config.get<string>(key)?.trim();
    if (!value) {
      throw new ServiceUnavailableException(
        `${key} ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ · ${key} is not configured; set it in backend/.env ` +
          'or run with PAYMENT_PROVIDER=simulated',
      );
    }
    return value;
  }
}

const empty = (): CallbackResult => ({
  ok: false,
  reference: null,
  txnRef: null,
  amountKip: null,
  status: null,
});

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
