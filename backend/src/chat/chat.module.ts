import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import {
  AdminChatController,
  CustomerChatController,
  PartnerChatController,
} from './chat.controller';

/**
 * Guest ↔ property messaging.
 *
 * Three controllers, one service. The access rule differs per role — a guest
 * owns their thread, a host reaches it through the property, an admin reads
 * everything — and putting that in one place is what stops the three from
 * drifting apart.
 */
@Module({
  controllers: [CustomerChatController, PartnerChatController, AdminChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
