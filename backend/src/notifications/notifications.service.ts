import { Injectable, Logger } from '@nestjs/common';
import { Prisma, notification_type } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Every notification the platform sends.
 *
 * Before this, six call sites each built their own Lao title and message inline
 * and wrote the row themselves. Two problems with that: changing the wording of
 * "your booking was cancelled" meant hunting through the booking service and
 * the payments service, and nothing could ever be delivered anywhere other than
 * the in-app list, because there was no single place to hand a message to.
 *
 * Wording now lives in `notification_templates`, keyed by a short code, with
 * `{{placeholder}}` substitution. The rows are seeded, so a copy change is a
 * database update rather than a deploy.
 *
 * **Delivery is deliberately not in this method.** See `deliver()`.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /** Templates change rarely and are read on every notification. */
  private cache: Map<string, Template> | null = null;
  private cachedAt = 0;
  private static readonly TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes one notification.
   *
   * `tx` decides whether the notification is part of the caller's transaction.
   * Pass it when the notification must not exist unless the thing it describes
   * does — a cancellation notice for a cancellation that rolled back is a lie.
   * Pass `null` when the reverse matters more: a booking must not fail because
   * telling the host failed.
   *
   * Never throws when `tx` is null. A notification is a side effect, and the
   * caller has already done the thing that matters.
   */
  async send(
    tx: Prisma.TransactionClient | null,
    input: {
      userId: bigint;
      templateCode: string;
      vars?: Record<string, string | number>;
      referenceType?: string;
      referenceId?: bigint;
      /** Overrides the template's own type, for the rare case it differs. */
      type?: notification_type;
    },
  ): Promise<void> {
    const template = await this.template(input.templateCode);

    if (!template) {
      // A missing template must not silence the notification entirely — the
      // guest still needs telling. Fall back to the code so the row is at least
      // traceable, and log loudly enough that it gets fixed.
      this.logger.error(
        `No active notification template "${input.templateCode}" — sending the code as the title`,
      );
    }

    const data = {
      user_id: input.userId,
      title: template ? render(template.title, input.vars) : input.templateCode,
      message: template ? render(template.message, input.vars) : null,
      notification_type: input.type ?? template?.type ?? notification_type.system,
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
    };

    if (tx) {
      await tx.notifications.create({ data });
      return;
    }

    try {
      await this.prisma.notifications.create({ data });
    } catch (err) {
      this.logger.error(
        `Failed to notify user ${input.userId} (${input.templateCode})`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Two people told the same thing — a guest and their host, usually. */
  async sendMany(
    tx: Prisma.TransactionClient | null,
    inputs: Parameters<NotificationsService['send']>[1][],
  ): Promise<void> {
    for (const input of inputs) await this.send(tx, input);
  }

  // ── reading ───────────────────────────────────────────────────────────────

  /**
   * The feed, identical for guests and hosts.
   *
   * It was duplicated verbatim in the customer and partner controllers; a
   * notification does not know or care which kind of account it belongs to.
   */
  async feed(userId: bigint, take = 50) {
    const [items, unread] = await Promise.all([
      this.prisma.notifications.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        take,
      }),
      this.unreadCount(userId),
    ]);

    return {
      items: items.map((n) => ({
        id: n.notification_id.toString(),
        title: n.title,
        message: n.message,
        type: n.notification_type,
        referenceType: n.reference_type,
        referenceId: n.reference_id?.toString() ?? null,
        isRead: n.is_read,
        createdAt: n.created_at,
      })),
      unread,
    };
  }

  unreadCount(userId: bigint): Promise<number> {
    return this.prisma.notifications.count({
      where: { user_id: userId, is_read: false },
    });
  }

  async markAllRead(userId: bigint) {
    const { count } = await this.prisma.notifications.updateMany({
      where: { user_id: userId, is_read: false },
      data: { is_read: true, read_at: new Date() },
    });
    return { updated: count };
  }

  async markRead(userId: bigint, notificationId: bigint) {
    // Scoped to the owner, so one account cannot mark another's as read.
    const { count } = await this.prisma.notifications.updateMany({
      where: { notification_id: notificationId, user_id: userId, is_read: false },
      data: { is_read: true, read_at: new Date() },
    });
    return { updated: count };
  }

  // ── templates ─────────────────────────────────────────────────────────────

  private async template(code: string): Promise<Template | null> {
    if (!this.cache || Date.now() - this.cachedAt > NotificationsService.TTL_MS) {
      const rows = await this.prisma.notification_templates.findMany({
        where: { is_active: true },
      });
      this.cache = new Map(
        rows.map((r) => [
          r.template_code,
          { title: r.title_template, message: r.message_template, type: r.notification_type },
        ]),
      );
      this.cachedAt = Date.now();
    }
    return this.cache.get(code) ?? null;
  }

  /** Call after editing templates so the change is visible immediately. */
  invalidateTemplates(): void {
    this.cache = null;
  }
}

interface Template {
  title: string;
  message: string;
  type: notification_type;
}

/**
 * Fills `{{name}}` placeholders.
 *
 * A placeholder with no value is left standing rather than blanked: a message
 * reading "ຄືນເງິນ {{refund}}" is obviously broken and gets reported, whereas
 * "ຄືນເງິນ " looks like the refund was nothing.
 */
function render(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole,
  );
}
