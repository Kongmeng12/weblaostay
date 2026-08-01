/**
 * EMVCo merchant-presented QR encoding — the format Lao PhaJay / LAPNet QRs use.
 *
 * The payload is a flat list of tag-length-value triples: a two-digit tag, a
 * two-digit *character* length, then the value. Templates (tags 26–51, 62) hold
 * a nested list in the same shape. The last field is always tag 63, a CRC over
 * everything before it including its own tag and length.
 */

/** One tag-length-value field. Length is characters, zero-padded to two digits. */
export function tlv(tag: string, value: string): string {
  if (value.length > 99) {
    throw new Error(`EMVCo field ${tag} is ${value.length} chars; the format allows 99`);
  }
  return tag + value.length.toString().padStart(2, '0') + value;
}

/**
 * CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF, no reflection,
 * no final XOR. Specified by EMVCo, and the one detail most implementations get
 * wrong — a QR with a bad CRC is rejected silently by the banking app.
 */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface QrFields {
  /** Merchant identifier issued by the acquirer. */
  merchantId: string;
  /** Acquirer's reverse-domain identifier, inside the merchant account template. */
  acquirerId: string;
  merchantName: string;
  merchantCity: string;
  /** Whole kip. */
  amountKip: number;
  /** Our booking reference, returned on the callback. */
  reference: string;
}

/** ISO 4217: Lao kip. Kip has no minor unit, so amounts carry no decimals. */
const CURRENCY_LAK = '418';
const COUNTRY_LA = 'LA';
/** MCC 7011 — lodging. */
const MCC_LODGING = '7011';

/**
 * Builds a dynamic (single-use, amount-carrying) merchant QR.
 *
 * Field order matters: EMVCo requires ascending tag order, and the CRC is
 * computed over the finished string with `6304` already appended.
 */
export function buildQrPayload(fields: QrFields): string {
  const merchantAccount = tlv('00', fields.acquirerId) + tlv('01', fields.merchantId);

  const body =
    tlv('00', '01') + // payload format indicator
    tlv('01', '12') + // dynamic: single use, amount included
    tlv('30', merchantAccount) + // merchant account information template
    tlv('52', MCC_LODGING) +
    tlv('53', CURRENCY_LAK) +
    tlv('54', String(Math.round(fields.amountKip))) +
    tlv('58', COUNTRY_LA) +
    tlv('59', truncate(fields.merchantName, 25)) +
    tlv('60', truncate(fields.merchantCity, 15)) +
    tlv('62', tlv('01', truncate(fields.reference, 25)));

  const withCrcTag = body + '6304';
  return withCrcTag + crc16(withCrcTag);
}

/** Parses a payload back into a tag → value map. Used by the tests and the simulator. */
export function parseQrPayload(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= payload.length) {
    const tag = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!Number.isFinite(len)) break;
    out[tag] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}
