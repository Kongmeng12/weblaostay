import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * The check-in QR a guest shows at the front desk.
 *
 * Why not just the booking code: `STL-0127` is booking 295 in hex, so anyone
 * can print a QR for a booking that is not theirs. This QR instead carries
 * the booking id plus an HMAC-SHA256 signature (RFC 2104) that only this
 * server can produce — the same idea as a signed airline boarding pass.
 *
 * Stateless on purpose: nothing is stored per booking, so no migration, and
 * a cancelled booking's QR stops working because the scan endpoint checks the
 * booking's status on every scan, not because a token was revoked.
 *
 * The QR holds a URL (`https://phaphak.com/c/v1.295.<sig>`) rather than a
 * bare token so a phone's ordinary camera opens a harmless page instead of
 * showing gibberish. That page never shows booking details — only the
 * partner app, signed in as the owning property, turns a scan into a booking.
 */
/** A QR is only worth showing while there is a check-in still to do. */
export const CHECK_IN_QR_STATUSES = new Set<string>(['confirmed', 'staying']);

@Injectable()
export class CheckinQrService {
  private readonly logger = new Logger(CheckinQrService.name);
  private readonly key: Buffer;
  private readonly appUrl: string;

  private static readonly VERSION = 'v1';
  /** 16 bytes of HMAC — 128 bits, far beyond guessing, and a small QR. */
  private static readonly SIG_BYTES = 16;
  private static readonly TOKEN = /^v1\.(\d{1,19})\.([A-Za-z0-9_-]{22})$/;

  constructor(config: ConfigService) {
    const dedicated = config.get<string>('CHECKIN_QR_SECRET')?.trim();
    if (dedicated) {
      this.key = Buffer.from(dedicated, 'utf8');
    } else {
      // Derived rather than required, so a teammate's .env without the new
      // variable still boots. HMAC is a PRF: the derived key reveals nothing
      // about the JWT secret. Rotating that secret re-keys every QR, though —
      // set CHECKIN_QR_SECRET in production to keep the two apart.
      this.logger.warn('CHECKIN_QR_SECRET is not set; deriving the check-in QR key from JWT_ACCESS_SECRET');
      this.key = createHmac('sha256', config.get<string>('JWT_ACCESS_SECRET') ?? '')
        .update('phaphak-checkin-qr-key-v1')
        .digest();
    }

    // Same source as the password-reset link and the trip URL in documents.
    const first = (config.get<string>('CORS_ORIGIN') ?? '').split(',')[0]?.trim();
    this.appUrl = (first || 'https://phaphak.com').replace(/\/+$/, '');
  }

  /** The URL to encode in the guest's QR for this booking. */
  urlFor(bookingId: bigint | string): string {
    const id = BigInt(bookingId).toString();
    return `${this.appUrl}/c/${CheckinQrService.VERSION}.${id}.${this.sign(id)}`;
  }

  /**
   * The booking id a scanned QR vouches for, or null when it is not one this
   * server signed. Accepts the full URL or the bare token, since some
   * scanners hand back only part of it.
   */
  verify(scanned: string): bigint | null {
    const raw = scanned.trim();
    const afterPath = raw.includes('/c/') ? raw.slice(raw.lastIndexOf('/c/') + 3) : raw;
    const token = afterPath.split(/[?#]/)[0];

    const match = CheckinQrService.TOKEN.exec(token);
    if (!match) return null;
    const [, id, sig] = match;

    const expected = Buffer.from(this.sign(id), 'utf8');
    const given = Buffer.from(sig, 'utf8');
    // Constant time, so response timing does not leak how much of a forged
    // signature was right.
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    return BigInt(id);
  }

  private sign(id: string): string {
    return createHmac('sha256', this.key)
      .update(`checkin|${CheckinQrService.VERSION}|${id}`)
      .digest()
      .subarray(0, CheckinQrService.SIG_BYTES)
      .toString('base64url');
  }
}
