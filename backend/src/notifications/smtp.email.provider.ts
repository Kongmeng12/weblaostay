import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Email, EmailProvider } from './email-provider.interface';

/**
 * Plain SMTP.
 *
 * Every mail host speaks it — Gmail, a company mail server, Resend, SES,
 * Postmark — so no vendor has to be chosen before email can work, and changing
 * vendor later is four lines of `.env` rather than a new provider class.
 *
 * The connection is opened once and reused: SMTP costs a TCP handshake, TLS and
 * an authentication round trip before a single byte of message moves, and doing
 * that per email would make a password reset noticeably slow.
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly logger = new Logger('Email');
  private transporter?: Transporter;

  constructor(private readonly config: ConfigService) {}

  async send(email: Email): Promise<void> {
    const from = this.optional('MAIL_FROM', '');
    if (!from) {
      throw new ServiceUnavailableException(
        'MAIL_FROM ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ · set MAIL_FROM in backend/.env, ' +
          'or run with EMAIL_PROVIDER=console',
      );
    }

    try {
      await this.connection().sendMail({ from, ...email });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`SMTP send to ${email.to} failed: ${detail}`);
      throw new ServiceUnavailableException('ສົ່ງອີເມວບໍ່ໄດ້ · Could not send the email');
    }
  }

  private connection(): Transporter {
    if (this.transporter) return this.transporter;

    const host = this.optional('SMTP_HOST', '');
    if (!host) {
      throw new ServiceUnavailableException(
        'SMTP_HOST ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ · set SMTP_HOST in backend/.env, ' +
          'or run with EMAIL_PROVIDER=console',
      );
    }

    const port = Number(this.optional('SMTP_PORT', '587'));
    const user = this.optional('SMTP_USER', '');
    const pass = this.optional('SMTP_PASSWORD', '');

    this.transporter = createTransport({
      host,
      port,
      // 465 is TLS from the first byte; 587 starts plain and upgrades with
      // STARTTLS. Getting this backwards hangs the connection rather than
      // failing, which is why it follows the port instead of being configurable.
      secure: port === 465,
      ...(user ? { auth: { user, pass } } : {}),
    });

    this.logger.log(`SMTP ${host}:${port}${user ? ` as ${user}` : ' (no auth)'}`);
    return this.transporter;
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
