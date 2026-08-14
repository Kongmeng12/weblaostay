import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { ConsoleSmsProvider } from './console.sms.provider';
import { WenovaSmsProvider } from './wenova.sms.provider';
import { SMS_PROVIDER } from './sms-provider.interface';
import { ConsoleEmailProvider } from './console.email.provider';
import { SmtpEmailProvider } from './smtp.email.provider';
import { EMAIL_PROVIDER } from './email-provider.interface';

/**
 * Notifications.
 *
 * Global because almost every module has a reason to tell somebody something —
 * bookings, payments, payouts, approvals, chat — and threading an import
 * through all of them adds nothing.
 *
 * `SMS_PROVIDER=wenova` and `EMAIL_PROVIDER=smtp` deliver for real and spend
 * real credit; anything else writes to the log. Defaulting to the log means a
 * fresh clone runs end to end with no credentials — but it also means
 * production must set both, so each choice is logged at boot and shouted about
 * if it is wrong.
 *
 * **Push is still missing.** It needs a provider of its own, following the same
 * shape. When it arrives it hangs off `send()` — and must fire *after* the
 * caller's transaction commits, or a rolled-back booking will still have
 * buzzed someone's phone.
 */
@Global()
@Module({
  providers: [
    NotificationsService,
    ConsoleSmsProvider,
    WenovaSmsProvider,
    ConsoleEmailProvider,
    SmtpEmailProvider,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, ConsoleSmsProvider, WenovaSmsProvider],
      useFactory: (
        config: ConfigService,
        consoleSms: ConsoleSmsProvider,
        wenova: WenovaSmsProvider,
      ) => {
        const choice = (config.get<string>('SMS_PROVIDER') ?? 'console').toLowerCase();
        const provider = choice === 'wenova' ? wenova : consoleSms;

        const log = new Logger('NotificationsModule');
        if (provider === consoleSms && config.get<string>('NODE_ENV') === 'production') {
          log.error(
            'Running in production with the CONSOLE SMS provider — no OTP will ' +
              'reach anyone and nobody can verify a phone number. Set SMS_PROVIDER=wenova.',
          );
        } else {
          log.log(`SMS provider: ${provider.name}`);
        }
        return provider;
      },
    },
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService, ConsoleEmailProvider, SmtpEmailProvider],
      useFactory: (
        config: ConfigService,
        consoleEmail: ConsoleEmailProvider,
        smtp: SmtpEmailProvider,
      ) => {
        const choice = (config.get<string>('EMAIL_PROVIDER') ?? 'console').toLowerCase();
        const provider = choice === 'smtp' ? smtp : consoleEmail;

        const log = new Logger('NotificationsModule');
        if (provider === consoleEmail && config.get<string>('NODE_ENV') === 'production') {
          log.error(
            'Running in production with the CONSOLE email provider — no reset ' +
              'link will reach anyone and nobody locked out can get back in. ' +
              'Set EMAIL_PROVIDER=smtp.',
          );
        } else {
          log.log(`Email provider: ${provider.name}`);
        }
        return provider;
      },
    },
  ],
  exports: [NotificationsService, SMS_PROVIDER, EMAIL_PROVIDER],
})
export class NotificationsModule {}
