import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { PaymentsService } from './payments.service';
import { SimulatedPaymentProvider } from './simulated.provider';
import { Actor, CurrentUser, Public, type AuthedUser } from '../common/decorators';
import { ACTOR } from '../common/actors';

@Controller('customer')
@Actor(ACTOR.USER)
export class CustomerPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Issues (or returns) the QR for a booking. */
  @Post('bookings/:id/pay')
  pay(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.payments.createForBooking(user.id, BigInt(id));
  }

  /** Polled by the "waiting for payment" screen. */
  @Get('payments/:id')
  findOne(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.payments.findOne(user.id, BigInt(id));
  }
}

/**
 * The acquirer's webhook, and its development stand-in.
 *
 * Public by necessity — a bank cannot hold a LaoStay token — so the HMAC over
 * the raw body is the whole of the authentication. `req.rawBody` is populated
 * because main.ts boots Nest with `rawBody: true`; verifying against
 * re-serialised JSON would fail the moment the provider's key order differed
 * from ours.
 */
@Controller('payments')
export class PaymentsWebhookController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly simulated: SimulatedPaymentProvider,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post('phajay/webhook')
  async webhook(@Req() req: Request & { rawBody?: Buffer }, @Res() res: Response) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
    const result = await this.payments.handleCallback(raw, req.headers as Record<string, unknown>);

    // A rejected signature must not read as "received" — providers retry on
    // non-2xx, which is what we want if the secret is misconfigured.
    res.status(result.accepted ? 200 : 401).json(result);
  }

  /**
   * Development only: settles a pending payment by signing a callback with the
   * simulator's secret and feeding it through the real webhook path — so what
   * the smoke test exercises is the production settlement code.
   */
  @Public()
  @HttpCode(200)
  @Post('dev/settle/:paymentId')
  async devSettle(@Param('paymentId') paymentId: string) {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException('ບໍ່ອະນຸຍາດໃນ production · Not available in production');
    }

    const payment = await this.payments.requirePayment(BigInt(paymentId));
    const body = Buffer.from(
      JSON.stringify({
        reference: `STL-${payment.booking_id.toString(16).toUpperCase().padStart(4, '0')}`,
        txnRef: payment.txn_ref ?? `SIM-${payment.id}`,
        amount: payment.amount,
        status: 'paid',
      }),
      'utf8',
    );

    return this.payments.handleCallback(body, {
      'x-phajay-signature': this.simulated.sign(body),
    });
  }
}
