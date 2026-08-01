import { Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { Actor, CurrentActor, type AuthedActor } from '../common/decorators';
import { ACTOR } from '../common/actors';

class ListNotificationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @IsOptional()
  @IsBooleanString()
  unreadOnly?: string;
}

/**
 * `notifications` is keyed by (recipient_type, recipient_id), so one service
 * shape works for all three actors — each only ever sees rows addressed to it.
 */
abstract class BaseNotificationsController {
  constructor(protected readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentActor() actor: AuthedActor, @Query() query: ListNotificationsDto) {
    const where = {
      recipient_type: actor.actorType,
      recipient_id: actor.id,
      ...(query.unreadOnly === 'true' ? { is_read: false } : {}),
    };

    const [rows, unread] = await Promise.all([
      this.prisma.notifications.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: query.limit,
      }),
      this.prisma.notifications.count({
        where: { recipient_type: actor.actorType, recipient_id: actor.id, is_read: false },
      }),
    ]);

    return { items: rows, unread };
  }

  @Patch(':id/read')
  async markRead(@CurrentActor() actor: AuthedActor, @Param('id') id: string) {
    // Scoped by recipient in the update itself, so one actor cannot mark
    // another's notification read by guessing an id.
    const { count } = await this.prisma.notifications.updateMany({
      where: {
        id: BigInt(id),
        recipient_type: actor.actorType,
        recipient_id: actor.id,
      },
      data: { is_read: true },
    });
    return { updated: count };
  }

  @Post('read-all')
  @HttpCode(200)
  async markAllRead(@CurrentActor() actor: AuthedActor) {
    const { count } = await this.prisma.notifications.updateMany({
      where: { recipient_type: actor.actorType, recipient_id: actor.id, is_read: false },
      data: { is_read: true },
    });
    return { updated: count };
  }
}

@Controller('customer/notifications')
@Actor(ACTOR.USER)
export class CustomerNotificationsController extends BaseNotificationsController {
  constructor(prisma: PrismaService) {
    super(prisma);
  }
}

@Controller('partner/notifications')
@Actor(ACTOR.PARTNER)
export class PartnerNotificationsController extends BaseNotificationsController {
  constructor(prisma: PrismaService) {
    super(prisma);
  }
}

@Controller('admin/notifications')
export class AdminNotificationsController extends BaseNotificationsController {
  constructor(prisma: PrismaService) {
    super(prisma);
  }
}
