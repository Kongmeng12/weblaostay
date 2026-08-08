import { Module, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { CustomerPaymentsController, PaymentsWebhookController } from './payments.controller';
import { SimulatedPaymentProvider } from './simulated.provider';
import { PhaJayPaymentProvider } from './phajay.provider';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { BookingModule } from '../booking/booking.module';

/**
 * `PAYMENT_PROVIDER=phajay` switches to the real rails; anything else uses the
 * simulator. Defaulting to the simulator means a fresh clone runs end to end
 * with no credentials — but it also means production must set the variable, so
 * the choice is logged at boot and shouted about if it is wrong.
 */
@Module({
  imports: [forwardRef(() => BookingModule)],
  controllers: [CustomerPaymentsController, PaymentsWebhookController],
  providers: [
    PaymentsService,
    SimulatedPaymentProvider,
    PhaJayPaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, SimulatedPaymentProvider, PhaJayPaymentProvider],
      useFactory: (
        config: ConfigService,
        simulated: SimulatedPaymentProvider,
        phajay: PhaJayPaymentProvider,
      ) => {
        const choice = (config.get<string>('PAYMENT_PROVIDER') ?? 'simulated').toLowerCase();
        const provider = choice === 'phajay' ? phajay : simulated;

        const log = new Logger('PaymentsModule');
        if (provider === simulated && config.get<string>('NODE_ENV') === 'production') {
          log.error(
            'Running in production with the SIMULATED payment provider — no real ' +
              'money will move. Set PAYMENT_PROVIDER=phajay.',
          );
        } else {
          log.log(`Payment provider: ${provider.name}`);
        }
        return provider;
      },
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
