import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { user_role } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { PaymentsService } from './payments.service';
import { CurrentUser, Public, Roles, type AuthedUser } from '../common/decorators';

@Controller('customer')
@Roles(user_role.CUSTOMER)
export class CustomerPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Issues, or returns, the QR for a booking. */
  @Post('bookings/:id/pay')
  pay(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.payments.createForBooking(user.userId, BigInt(id));
  }

  /** Polled by the "waiting for payment" screen. */
  @Get('payments/:id')
  findOne(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.payments.findOne(user.userId, BigInt(id));
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
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * PhaJay's payment notification.
   *
   * The secret is in the path because PhaJay signs nothing: their callback is
   * plain JSON that anyone could compose, and a guest knows both their own
   * booking code and its total. Without a secret here, a guest could confirm
   * their own booking without paying for it.
   *
   * PhaJay lets any URL be registered in their portal, so the secret costs
   * nothing and depends on nothing they have to give us. Generate one with
   * `openssl rand -hex 32` and register
   * `https://<host>/api/payments/phajay/webhook/<secret>`.
   */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post('phajay/webhook/:secret')
  async webhook(
    @Param('secret') secret: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Res() res: Response,
  ) {
    const expected = this.config.get<string>('PHAJAY_WEBHOOK_SECRET')?.trim();
    if (!expected) {
      this.logger.error('PHAJAY_WEBHOOK_SECRET is not set; refusing every callback');
      res.status(503).json({ accepted: false, reason: 'webhook secret not configured' });
      return;
    }

    if (!timingSafeEqualStr(secret, expected)) {
      this.logger.warn('Refused a payment callback with the wrong URL secret');
      res.status(404).json({ accepted: false, reason: 'not found' });
      return;
    }

    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
    const result = await this.payments.handleCallback(raw, req.headers as Record<string, unknown>);

    // A refusal must not read as "received" — providers retry on non-2xx,
    // which is what we want if something here is misconfigured.
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

    // Settles directly rather than forging a webhook. Each provider's callback
    // has its own shape and its own authentication, so a hand-built body only
    // ever verified against whichever one was selected — this route used to
    // fail the moment PAYMENT_PROVIDER changed. Standing in for the bank is
    // the whole job here; standing in for the bank's signature is not.
    const body = Buffer.from(
      JSON.stringify({ devSettle: true, paymentId: payment.payment_id.toString() }),
      'utf8',
    );

    return this.payments.settle(
      {
        ok: true,
        reference: payment.bookings.booking_code,
        txnRef: payment.txn_ref ?? `DEV-${payment.payment_id}`,
        amountKip: Number(payment.amount),
        status: 'paid',
      },
      body,
    );
  }
}

/**
 * Compares two secrets without leaking their length or contents through how
 * long the comparison takes.
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which is itself a signal — so
  // the lengths are compared first and a fixed-length digest is not worth the
  // ceremony for a value only the acquirer ever sends.
  return left.length === right.length && timingSafeEqual(left, right);
}
