import { Injectable, Logger } from '@nestjs/common';
import type { Email, EmailProvider } from './email-provider.interface';

/**
 * Writes the message to the log instead of sending it.
 *
 * The default, so a fresh clone runs end to end with no mail credentials. The
 * plain-text body is logged in full — a reset link is unusable otherwise, and
 * this is how the link is read during development.
 *
 * Selecting this in production is an error, and `NotificationsModule` says so
 * loudly at boot.
 */
@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  private readonly logger = new Logger('Email');

  send(email: Email): Promise<void> {
    this.logger.log(`To ${email.to} — ${email.subject}\n${email.text}`);
    return Promise.resolve();
  }
}
