import { Injectable, Logger } from '@nestjs/common';
import { laoMobile, type SmsProvider } from './sms-provider.interface';

/**
 * Writes the message to the log instead of sending it.
 *
 * The default, so a fresh clone runs end to end with no SMS credentials and no
 * spend. The body is logged in full — an OTP is unusable otherwise, and this is
 * how the code is read during development.
 *
 * The number is still normalised and still refused if it is not a Lao mobile,
 * so a bad number is caught here rather than surviving until the day real
 * credentials are switched on.
 *
 * Selecting this in production is an error, and `NotificationsModule` says so
 * loudly at boot.
 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  private readonly logger = new Logger('SMS');

  send(to: string, message: string): Promise<void> {
    const number = laoMobile(to);
    if (!number) {
      return Promise.reject(new Error(`${to} ບໍ່ແມ່ນເບີມືຖືລາວ · not a Lao mobile number`));
    }

    this.logger.log(`To ${number}: ${message}`);
    return Promise.resolve();
  }
}
