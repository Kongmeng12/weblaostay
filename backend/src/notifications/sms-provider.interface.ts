/**
 * Injection token for the SMS provider.
 *
 * A `Symbol` rather than a string so nothing can collide with it, matching
 * `PAYMENT_PROVIDER` and `STORAGE_PROVIDER`.
 */
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsProvider {
  /** Named in the boot log so it is obvious which one is live. */
  readonly name: string;

  /**
   * Sends one message.
   *
   * `to` is whatever the platform stored — `+856 20 5511 0001`, `2055110001`,
   * `020 5511 0001`. Each provider puts it into the shape its own API wants;
   * callers do not have to know.
   *
   * Throws if the message could not be handed off. Callers answering a user
   * request should catch: asking for an OTP must not report *which* numbers
   * exist, and a slow gateway is not the caller's problem.
   */
  send(to: string, message: string): Promise<void>;
}

/**
 * Reduces a stored phone number to the ten digits a Lao mobile actually is.
 *
 * The database holds `+856 20 5511 0001`; Wenova wants `2055110001` and
 * rejects everything else, so getting this wrong means every message fails.
 * Both the country code and the trunk `0` are dropped — `+856 20 …`,
 * `856 20 …`, `020 …` and `20 …` are the same subscriber written four ways.
 *
 * Returns `null` when the result is not a Lao mobile, so the caller can refuse
 * rather than send to a number that cannot receive.
 */
export function laoMobile(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');

  if (digits.startsWith('856')) digits = digits.slice(3);
  // A trunk prefix, only ever written before the operator code.
  if (digits.startsWith('0')) digits = digits.slice(1);

  // Every Lao mobile is 20 followed by eight digits. Landlines (21, 31, …) are
  // shorter and cannot receive SMS, so they are refused here rather than at the
  // gateway.
  return /^20\d{8}$/.test(digits) ? digits : null;
}

/**
 * The ten digits `laoMobile()` returns, written back out as `+856 20 5555
 * 0001` — the one shape every phone number is stored and looked up in.
 *
 * A customer can type `020 5555 0001`, `20-5555-0001` or `+856205550001` and
 * still land on the same account, at both register and login, because both
 * ends of that comparison go through this same function first.
 */
export function formatLaoPhone(digits: string): string {
  return `+856 ${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6, 10)}`;
}
