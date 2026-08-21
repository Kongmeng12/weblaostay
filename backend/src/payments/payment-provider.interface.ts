/**
 * What a payment provider has to do for PhaPhak.
 *
 * Two implementations exist: `SimulatedPaymentProvider` for development, and
 * `PhaJayPaymentProvider` for the real LAPNet/PhaJay rails. Everything else in
 * the codebase talks to this interface, so switching is one env var and no code
 * changes — and so the parts that are hard to get right (idempotency, the
 * booking transition, notifications) are written once, in PaymentsService,
 * rather than once per provider.
 */

export interface ChargeRequest {
  bookingId: bigint;
  /** Whole kip. */
  amountKip: number;
  /** Our own reference, echoed back on the callback. */
  reference: string;
  /** Shown in the payer's banking app. */
  description: string;
}

export interface ChargeResult {
  /** The EMVCo string the app draws as a QR code. */
  qrPayload: string;
  /**
   * A link straight into the payer's banking app, when the acquirer gives one.
   *
   * On a phone the payer cannot scan the screen they are holding, so the app
   * offers this as a button beside the QR.
   */
  deepLink: string | null;
  /** The provider's own id for this charge. */
  providerRef: string | null;
  expiresAt: Date;
}

export interface CallbackResult {
  /** False when the signature does not verify — the caller must respond 401. */
  ok: boolean;
  /** Our reference, as sent in `ChargeRequest.reference`. */
  reference: string | null;
  /** The provider's transaction id — the idempotency key for settlement. */
  txnRef: string | null;
  amountKip: number | null;
  /** `paid` | `expired` | `failed`. */
  status: string | null;
  reason?: string;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface PaymentProvider {
  readonly name: string;
  createCharge(request: ChargeRequest): Promise<ChargeResult>;
  /**
   * Reads a webhook and says whether to trust it.
   *
   * Given the raw body bytes because a signature computed over re-serialised
   * JSON is worthless — key order and whitespace would differ from what the
   * provider signed. An acquirer that does not sign at all has to be defended
   * some other way; see the note on PhaJayPaymentProvider.
   */
  verifyCallback(rawBody: Buffer, headers: Record<string, unknown>): CallbackResult;
}
