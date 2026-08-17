import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
      // Neon is a network hop away — a round trip costs 100-300 ms from here,
      // and the booking transaction makes several. Prisma's 5 s default aborts
      // it with P2028 on a slow link, so both limits are raised well clear of
      // the worst case. The work inside is still kept to a handful of queries;
      // this is headroom, not licence to add more.
      transactionOptions: { timeout: 20_000, maxWait: 10_000 },
    });
  }

  /**
   * Neon's serverless compute suspends itself after a few minutes of no
   * traffic and takes several seconds to wake back up on the next
   * connection. A single `$connect()` attempt can land inside that wake-up
   * window and fail with P1001 even though the database is fine a moment
   * later — so retry with backoff instead of taking the whole app down on
   * what is usually just a cold start.
   */
  async onModuleInit(): Promise<void> {
    const attempts = 5;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.$connect();
        this.logger.log('Connected to Neon PostgreSQL');
        return;
      } catch (error) {
        if (attempt === attempts) throw error;
        const delayMs = 1_000 * 2 ** (attempt - 1); // 1s, 2s, 4s, 8s
        this.logger.warn(
          `Database connection attempt ${attempt}/${attempts} failed — likely Neon waking from idle. Retrying in ${delayMs}ms.`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
