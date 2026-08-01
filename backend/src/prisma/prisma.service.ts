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

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to Neon PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
