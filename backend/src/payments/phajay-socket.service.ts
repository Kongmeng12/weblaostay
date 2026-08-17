import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { io, type Socket } from 'socket.io-client';
import { PaymentsService } from './payments.service';

const DEFAULT_SOCKET_URL = 'https://payment-gateway.phajay.co/';

/**
 * PhaJay's real-time payment feed.
 *
 * PhaJay has no endpoint for asking whether a transaction was paid — the
 * documented ways to find out are a webhook and this socket. A webhook needs a
 * public URL, which a development machine does not have and a server behind
 * NAT may not either, and a webhook that fails to arrive leaves a guest who has
 * paid staring at a QR code forever.
 *
 * This connects *outwards* instead: the server dials PhaJay and subscribes with
 * its own secret key, so payments settle on localhost with nothing exposed.
 *
 * It is a second path to the same place, not a replacement. Both this and the
 * webhook end at `handleCallback`, which is idempotent — a payment already
 * `paid` is recognised and skipped, so the two arriving together is fine and
 * either one arriving alone is enough.
 */
@Injectable()
export class PhaJaySocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PhaJaySocket');
  private socket?: Socket;

  constructor(
    private readonly config: ConfigService,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit(): void {
    if ((this.config.get<string>('PAYMENT_PROVIDER') ?? '').toLowerCase() !== 'phajay') return;

    const secretKey = this.config.get<string>('PHAJAY_API_KEY')?.trim();
    if (!secretKey) {
      this.logger.warn('PHAJAY_API_KEY is not set — payments will only settle by webhook');
      return;
    }

    const url = (this.config.get<string>('PHAJAY_SOCKET_URL')?.trim() || DEFAULT_SOCKET_URL);
    this.socket = io(url, {
      // Left to reconnect on its own: the alternative is a server that quietly
      // stops hearing about payments after one network blip.
      reconnection: true,
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 30_000,
    });

    // The subscription *is* the event name — PhaJay routes each merchant's
    // traffic by putting the key in it rather than in an auth handshake.
    const channel = `join::${secretKey}`;

    this.socket.on('connect', () => {
      this.logger.log(`Listening for payments on ${url}`);
      this.socket?.off(channel);
      this.socket?.on(channel, (data: unknown) => void this.onPayment(data));
    });

    // The first failure is worth seeing — a feed that never connects means
    // payments silently never settle. The retries after it are not: socket.io
    // keeps trying, and one line per attempt buries everything else.
    let reported = false;
    this.socket.on('connect_error', (err: Error) => {
      if (reported) {
        this.logger.debug(`Payment socket retry failed: ${err.message}`);
        return;
      }
      reported = true;
      this.logger.warn(`Payment socket cannot reach ${url}: ${err.message} — retrying quietly`);
    });

    this.socket.on('connect', () => {
      reported = false;
    });

    this.socket.on('disconnect', (reason: string) => {
      this.logger.warn(`Payment socket dropped (${reason}) — reconnecting`);
    });
  }

  onModuleDestroy(): void {
    this.socket?.close();
  }

  /**
   * Settles whatever arrived.
   *
   * The payload is the same JSON the webhook receives, so it goes through the
   * same door — including the checks that the payment is still pending and that
   * the amount matches what was charged. Nothing here is trusted just because
   * it came over a socket.
   */
  private async onPayment(data: unknown): Promise<void> {
    try {
      const raw = Buffer.from(JSON.stringify(data ?? {}), 'utf8');
      const result = await this.payments.handleCallback(raw, {});

      // The result is a union across several outcomes, so it is logged whole
      // rather than picked apart — every branch is worth reading here.
      if (result.accepted) this.logger.log(`Socket settlement: ${JSON.stringify(result)}`);
      else this.logger.warn(`Socket payment not accepted: ${JSON.stringify(result)}`);
    } catch (err) {
      // A throw here would take down the socket handler and with it every
      // later payment, so it stops at the one that failed.
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to settle a socket payment: ${detail}`);
    }
  }
}
