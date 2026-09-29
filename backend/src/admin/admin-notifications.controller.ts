import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { user_role } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { CurrentUser, Roles, type AuthedUser } from '../common/decorators';

/**
 * The admin's own feed — the bell in the WebAdmin header.
 *
 * The same feed guests and hosts read, just under /admin: each admin has their
 * own rows (see `NotificationsService.sendToAdmins`), so there is nothing
 * admin-specific to do beyond the route.
 */
@Controller('admin/notifications')
@Roles(user_role.ADMIN)
export class AdminNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  feed(@CurrentUser() user: AuthedUser) {
    return this.notifications.feed(user.userId, 30);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthedUser) {
    return this.notifications.markAllRead(user.userId);
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.notifications.markRead(user.userId, BigInt(id));
  }
}
