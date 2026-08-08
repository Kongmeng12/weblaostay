import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { conversation_status, user_role } from '@prisma/client';
import { ChatService } from './chat.service';
import { Audit, CurrentUser, Roles, type AuthedUser } from '../common/decorators';

class StartConversationDto {
  @IsString()
  propertyId!: string;

  /** Optional — a question before booking is a conversation worth having. */
  @IsOptional()
  @IsString()
  bookingId?: string;
}

class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;

  @IsOptional()
  @IsString()
  replyToId?: string;
}

class MessagesQueryDto {
  /**
   * A message id, not a timestamp. Two messages written in the same
   * millisecond would make a time cursor skip one or repeat it.
   */
  @IsOptional()
  @IsString()
  since?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

class SetStatusDto {
  @IsEnum(conversation_status)
  status!: conversation_status;
}

/**
 * The guest's side.
 *
 * Only a guest may open a thread. A property messaging someone who never
 * contacted them is how a booking platform turns into a spam channel.
 */
@Controller('customer/conversations')
@Roles(user_role.CUSTOMER)
export class CustomerChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(@CurrentUser() user: AuthedUser) {
    return this.chat.list(user.userId, user_role.CUSTOMER);
  }

  @Get('unread')
  async unread(@CurrentUser() user: AuthedUser) {
    return { total: await this.chat.unreadTotal(user.userId, user_role.CUSTOMER) };
  }

  @Post()
  start(@CurrentUser() user: AuthedUser, @Body() dto: StartConversationDto) {
    return this.chat.start(
      user.userId,
      BigInt(dto.propertyId),
      dto.bookingId ? BigInt(dto.bookingId) : undefined,
    );
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.chat.detail(user.userId, user_role.CUSTOMER, BigInt(id));
  }

  @Get(':id/messages')
  messages(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Query() query: MessagesQueryDto,
  ) {
    return this.chat.messages(user.userId, user_role.CUSTOMER, BigInt(id), {
      since: query.since ? BigInt(query.since) : undefined,
      limit: query.limit,
    });
  }

  @Post(':id/messages')
  send(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chat.send(user.userId, user_role.CUSTOMER, BigInt(id), {
      text: dto.text,
      replyToId: dto.replyToId ? BigInt(dto.replyToId) : undefined,
    });
  }

  @Delete(':id/messages/:messageId')
  remove(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.chat.remove(user.userId, user_role.CUSTOMER, BigInt(id), BigInt(messageId));
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.chat.markRead(user.userId, user_role.CUSTOMER, BigInt(id));
  }
}

/** The property's side. Same threads, resolved through property ownership. */
@Controller('partner/conversations')
@Roles(user_role.PARTNER)
export class PartnerChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(@CurrentUser() user: AuthedUser) {
    return this.chat.list(user.userId, user_role.PARTNER);
  }

  @Get('unread')
  async unread(@CurrentUser() user: AuthedUser) {
    return { total: await this.chat.unreadTotal(user.userId, user_role.PARTNER) };
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.chat.detail(user.userId, user_role.PARTNER, BigInt(id));
  }

  @Get(':id/messages')
  messages(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Query() query: MessagesQueryDto,
  ) {
    return this.chat.messages(user.userId, user_role.PARTNER, BigInt(id), {
      since: query.since ? BigInt(query.since) : undefined,
      limit: query.limit,
    });
  }

  @Post(':id/messages')
  send(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.chat.send(user.userId, user_role.PARTNER, BigInt(id), {
      text: dto.text,
      replyToId: dto.replyToId ? BigInt(dto.replyToId) : undefined,
    });
  }

  @Delete(':id/messages/:messageId')
  remove(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.chat.remove(user.userId, user_role.PARTNER, BigInt(id), BigInt(messageId));
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.chat.markRead(user.userId, user_role.PARTNER, BigInt(id));
  }

  /** Either side may close a thread once the stay is over. */
  @Post(':id/status')
  @HttpCode(200)
  @Audit('chat_status_change', 'partner', 'conversations')
  setStatus(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: SetStatusDto,
  ) {
    return this.chat.setStatus(user.userId, user_role.PARTNER, BigInt(id), dto.status);
  }
}

/**
 * Read-only for staff.
 *
 * A dispute is settled by reading what was actually said, so admins can see any
 * thread — but `ChatService.send` refuses them, because a message that looks
 * like it came from the property but did not would poison the same evidence.
 */
@Controller('admin/conversations')
@Roles(user_role.ADMIN)
export class AdminChatController {
  constructor(private readonly chat: ChatService) {}

  @Get(':id')
  detail(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.chat.detail(user.userId, user_role.ADMIN, BigInt(id));
  }

  @Get(':id/messages')
  messages(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Query() query: MessagesQueryDto,
  ) {
    return this.chat.messages(user.userId, user_role.ADMIN, BigInt(id), {
      since: query.since ? BigInt(query.since) : undefined,
      limit: query.limit,
    });
  }
}
