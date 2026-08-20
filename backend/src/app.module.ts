import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { BookingModule } from './booking/booking.module';
import { PaymentsModule } from './payments/payments.module';
import { PartnerModule } from './partner/partner.module';
import { ChatModule } from './chat/chat.module';
import { ReviewsModule } from './reviews/reviews.module';
import { CmsModule } from './cms/cms.module';
import { AdminModule } from './admin/admin.module';
import { UploadsModule } from './uploads/uploads.module';
import { HealthController } from './health.controller';
import { MapsController } from './maps/maps.controller';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { BigIntInterceptor } from './common/interceptors/bigint.interceptor';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    // Drives the hold sweeper. Without it, an abandoned checkout keeps a room
    // off sale for good.
    ScheduleModule.forRoot(),
    PrismaModule,
    CommonModule,
    NotificationsModule,
    AuthModule,
    CatalogModule,
    BookingModule,
    PaymentsModule,
    PartnerModule,
    ChatModule,
    ReviewsModule,
    CmsModule,
    AdminModule,
    UploadsModule,
  ],
  controllers: [HealthController, MapsController],
  providers: [
    // Order matters: rate limit, then authenticate, then authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },

    // Audit runs first so it sees the raw handler result; BigInt serialisation
    // is the last thing to touch the payload before it is written out.
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    { provide: APP_INTERCEPTOR, useClass: BigIntInterceptor },
  ],
})
export class AppModule {}
