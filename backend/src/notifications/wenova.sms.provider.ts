import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { laoMobile, type SmsProvider } from './sms-provider.interface';

const DEFAULT_BASE_URL = 'https://apimicroservices.wenova.fun';

/** The one gateway result that means the message went out. */
const DELIVERED = 20000;

/**
 * Wenova's error text, which arrives three different ways: a plain string, a
 * nested `{ message }`, or an array of validation lines.
 */
function describe(message: unknown): string {
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join('; ');
  if (message && typeof message === 'object') {
    return describe((message as { message?: unknown }).message);
  }
  return '';
}

/**
 * Wenova Link — `POST /sms/package`.
 *
 * The credential travels in the body, not a header, and there is no login step:
 * this endpoint is built for server-to-server use.
 *
 * ## scriptId, not token
 *
 * Wenova issues two interchangeable credentials for the same account. The API
 * token can be rotated from their dashboard and therefore expires; the script
 * id does not. A server that nobody is watching should hold the one that cannot
 * go stale, so `WENOVA_SCRIPT_ID` is preferred and `WENOVA_API_TOKEN` is the
 * fallback.
 *
 * ## What it costs
 *
 * Billing is per segment, and a segment is 153 ASCII characters *or 67* once
 * any Lao character appears — so a Lao OTP message costs more than twice what
 * the same message in digits and English costs. Nothing here shortens the
 * message; that is the caller's decision, but it is worth knowing.
 */
@Injectable()
export class WenovaSmsProvider implements SmsProvider {
  readonly name = 'wenova';
  private readonly logger = new Logger('SMS');

  constructor(private readonly config: ConfigService) {}

  async send(to: string, message: string): Promise<void> {
    const number = laoMobile(to);
    if (!number) throw new Error(`${to} ບໍ່ແມ່ນເບີມືຖືລາວ · not a Lao mobile number`);

    // Wenova refuses any message containing a link (code 30102). Catching it
    // here names the real problem; the gateway's own error does not say which
    // message was rejected.
    if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|la|link|io)\b/i.test(message)) {
      throw new Error('Wenova ປະຕິເສດຂໍ້ຄວາມທີ່ມີລິ້ງ · Wenova rejects SMS containing links');
    }

    const baseUrl = this.optional('WENOVA_BASE_URL', DEFAULT_BASE_URL).replace(/\/+$/, '');
    const scriptId = this.optional('WENOVA_SCRIPT_ID', '');
    const token = this.optional('WENOVA_API_TOKEN', '');

    // 15 digits fits a JS number exactly; more would round and silently address
    // somebody else's script.
    if (scriptId && scriptId.replace(/\D/g, '').length > 15) {
      throw new Error(`WENOVA_SCRIPT_ID ຍາວເກີນໄປ · script id has too many digits to send as a number`);
    }

    if (!scriptId && !token) {
      throw new ServiceUnavailableException(
        'WENOVA_SCRIPT_ID ຫຼື WENOVA_API_TOKEN ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ · set one in backend/.env, ' +
          'or run with SMS_PROVIDER=console',
      );
    }

    const body = JSON.stringify({
      header: this.optional('WENOVA_SENDER', 'WNV-OTP'),
      phoneNumber: number,
      message,
      // Exactly one is required. Their schema types the id as a number, but the
      // dashboard shows it grouped — `884-123-…` — so the separators are
      // stripped before it can become NaN and come back as a 30308.
      ...(scriptId ? { scriptId: Number(scriptId.replace(/\D/g, '')) } : { token }),
      // true spends the prepaid OTP package, false spends the kip wallet.
      usePackage: this.optional('WENOVA_USE_PACKAGE', 'true') !== 'false',
    });

    let json: {
      success?: boolean;
      code?: number;
      statusCode?: number;
      message?: unknown;
      data?: {
        transaction_id?: string;
        resultCode?: number | null;
        resultDesc?: string | null;
        developerMessage?: string | null;
      };
    };
    let status: number;
    try {
      const res = await fetch(`${baseUrl}/sms/package`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      status = res.status;
      json = JSON.parse(await res.text()) as typeof json;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Wenova request failed: ${detail}`);
      throw new ServiceUnavailableException('ສົ່ງ SMS ບໍ່ໄດ້ · Could not send the SMS');
    }

    // A refusal answers with a non-2xx status and a nested message. The code is
    // worth keeping: 30105 means the OTP package is empty and 30106 means the
    // wallet is, and those need different people to fix them.
    if (status >= 300 || json.success === false) {
      const detail = describe(json.message) || `HTTP ${status}`;
      this.logger.error(`Wenova refused ${number}: ${json.code ?? status} ${detail}`);
      throw new ServiceUnavailableException(`ສົ່ງ SMS ບໍ່ໄດ້ (${json.code ?? status}) · ${detail}`);
    }

    const { transaction_id, resultCode, resultDesc, developerMessage } = json.data ?? {};

    // `resultCode` is null on the way out: Wenova answers as soon as it has
    // queued the message, and the network's verdict lands later. A null is
    // therefore *accepted*, not failed — treating it as failed would have this
    // provider throw on every message it successfully sent.
    if (resultCode == null && !resultDesc) {
      this.logger.log(`Wenova queued a message for ${number} (${transaction_id ?? 'no id'})`);
      return;
    }

    if (resultCode !== DELIVERED && !/success/i.test(resultDesc ?? '')) {
      this.logger.error(
        `Wenova did not deliver to ${number}: ${resultCode ?? ''} ` +
          `${resultDesc ?? ''} ${developerMessage ?? ''}`,
      );
      throw new ServiceUnavailableException('ສົ່ງ SMS ບໍ່ສຳເລັດ · The SMS was not delivered');
    }
  }

  /**
   * A setting, or the fallback when it is absent **or blank**.
   *
   * `ConfigService.get(key, fallback)` only falls back on `undefined`, and a
   * `.env` listing a key with nothing after the `=` gives an empty string.
   */
  private optional(key: string, fallback: string): string {
    const value = this.config.get<string>(key);
    return value !== undefined && value.trim() !== '' ? value.trim() : fallback;
  }
}
