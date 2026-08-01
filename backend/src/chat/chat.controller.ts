import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ChatService } from './chat.service';
import { Actor, CurrentActor, type AuthedActor } from '../common/decorators';
import { ACTOR } from '../common/actors';

class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}

class SinceDto {
  /** Message id the client already has. Ids are BigInt, so it travels as text. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  since?: string;
}

/**
 * One service, three mount points.
 *
 * The global guard picks a passport strategy from the `@Actor()` on the class,
 * so each actor needs its own controller — but the behaviour, and the access
 * rules, live once in ChatService.
 */
abstract class BaseChatController {
  constructor(protected readonly chat: ChatService) {}

  @Get('bookings/:id/messages')
  list(
    @CurrentActor() actor: AuthedActor,
    @Param('id') id: string,
    @Query() query: SinceDto,
  ) {
    return this.chat.list(actor, BigInt(id), query.since ? BigInt(query.since) : undefined);
  }

  @Post('bookings/:id/messages')
  send(
    @CurrentActor() actor: AuthedActor,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chat.send(actor, BigInt(id), dto.body);
  }

  @Patch('bookings/:id/read')
  markRead(@CurrentActor() actor: AuthedActor, @Param('id') id: string) {
    return this.chat.markRead(actor, BigInt(id));
  }

  @Get('unread')
  @HttpCode(200)
  unread(@CurrentActor() actor: AuthedActor) {
    return this.chat.unread(actor);
  }
}

// Each subclass declares its own constructor on purpose: TypeScript only emits
// `design:paramtypes` for a class that has one, and without that metadata Nest
// cannot resolve the inherited dependency.

@Controller('customer/chat')
@Actor(ACTOR.USER)
export class CustomerChatController extends BaseChatController {
  constructor(chat: ChatService) {
    super(chat);
  }
}

@Controller('partner/chat')
@Actor(ACTOR.PARTNER)
export class PartnerChatController extends BaseChatController {
  constructor(chat: ChatService) {
    super(chat);
  }
}

@Controller('admin/chat')
export class AdminChatController extends BaseChatController {
  constructor(chat: ChatService) {
    super(chat);
  }
}
