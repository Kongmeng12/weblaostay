import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import {
  CustomerChatController,
  PartnerChatController,
  AdminChatController,
} from './chat.controller';
import {
  CustomerNotificationsController,
  PartnerNotificationsController,
  AdminNotificationsController,
} from './notifications.controller';

/** Chat and notifications — the two features every actor shares. */
@Module({
  controllers: [
    CustomerChatController,
    PartnerChatController,
    AdminChatController,
    CustomerNotificationsController,
    PartnerNotificationsController,
    AdminNotificationsController,
  ],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
