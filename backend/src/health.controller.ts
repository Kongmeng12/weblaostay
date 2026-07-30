import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { Public } from './common/decorators';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    const started = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      database: 'connected',
      dbLatencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }
}
