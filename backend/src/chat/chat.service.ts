import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { conversation_status, message_type, user_role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Guest ↔ property messaging.
 *
 * A conversation belongs to a **property**, not a partner: a guest writes to
 * the place they are staying, and whoever owns it that week answers. The
 * partner side is resolved through `properties.partner_id → partners.user_id`.
 *
 * `booking_id` is optional on purpose — a guest asking "do you have parking?"
 * before booking is exactly the conversation worth having.
 *
 * **Unread is a cursor, not a flag.** `conversation_reads.last_read_message_id`
 * marks how far a participant has got; anything newer from the other side is
 * unread. Marking a per-message flag would mean writing a row for every message
 * a busy property never opens.
 *
 * **Never write `conversations.last_message_id` or `last_message_at`.** The
 * `t_messages_touch_conversation` trigger does it on insert, and a second
 * writer would race it.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── access ────────────────────────────────────────────────────────────────

  /**
   * Resolves a conversation the caller is allowed to see, or 404s.
   *
   * 404 rather than 403 for someone else's thread, matching `OwnershipService`:
   * a 403 confirms the id exists, which is enough to enumerate them.
   */
  private async require(userId: bigint, role: user_role, conversationId: bigint) {
    const conversation = await this.prisma.conversations.findUnique({
      where: { conversation_id: conversationId },
      include: {
        properties: {
          select: {
            property_id: true,
            property_name: true,
            partner_id: true,
            partners: { select: { user_id: true } },
          },
        },
      },
    });

    if (!conversation) throw new NotFoundException('ບໍ່ພົບການສົນທະນາ · Conversation not found');

    const isCustomer = conversation.customer_id === userId;
    const isHost = conversation.properties.partners.user_id === userId;
    // Admins read every thread — moderating a dispute is the point.
    const isAdmin = role === user_role.ADMIN;

    if (!isCustomer && !isHost && !isAdmin) {
      throw new NotFoundException('ບໍ່ພົບການສົນທະນາ · Conversation not found');
    }

    return { conversation, isCustomer, isHost, isAdmin };
  }

  /** The other participant, for notifications. */
  private counterpart(
    conversation: { customer_id: bigint; properties: { partners: { user_id: bigint } } },
    senderId: bigint,
  ): bigint {
    return senderId === conversation.customer_id
      ? conversation.properties.partners.user_id
      : conversation.customer_id;
  }

  // ── listing ───────────────────────────────────────────────────────────────

  /**
   * Every thread the caller is part of, newest activity first, each with its
   * unread count.
   *
   * The counts come from one grouped query rather than one per conversation —
   * a property with fifty threads should cost two round trips, not fifty-one.
   */
  async list(userId: bigint, role: user_role) {
    const where =
      role === user_role.PARTNER
        ? { properties: { partners: { user_id: userId } } }
        : { customer_id: userId };

    const conversations = await this.prisma.conversations.findMany({
      where,
      orderBy: [{ last_message_at: 'desc' }, { conversation_id: 'desc' }],
      take: 100,
      include: {
        properties: { select: { property_id: true, property_name: true } },
        users: { include: { user_profiles: { select: { full_name: true } } } },
        bookings: { select: { booking_id: true, booking_code: true } },
        conversation_reads: { where: { user_id: userId } },
        // `conversations` and `messages` point at each other — a conversation
        // caches its last message, a message names its conversation — so
        // Prisma cannot infer which relation is which and disambiguates both
        // by name. `db pull` regenerates these, so renaming them in the schema
        // would not survive.
        messages_messages_conversation_idToconversations: {
          orderBy: { message_id: 'desc' },
          take: 1,
          select: { message_id: true, message_text: true, sender_id: true, is_deleted: true },
        },
      },
    });

    if (!conversations.length) return { items: [], unreadTotal: 0 };

    const unread = await this.unreadPerConversation(
      userId,
      conversations.map((c) => c.conversation_id),
    );

    const items = conversations.map((c) => {
      const last = c.messages_messages_conversation_idToconversations[0];
      return {
        id: c.conversation_id.toString(),
        propertyId: c.properties.property_id.toString(),
        property: c.properties.property_name,
        // Whichever side the caller is not.
        counterpartName:
          role === user_role.PARTNER
            ? (c.users.user_profiles?.full_name ?? c.users.email)
            : c.properties.property_name,
        bookingId: c.bookings?.booking_id.toString() ?? null,
        bookingCode: c.bookings?.booking_code ?? null,
        status: c.status,
        lastMessage: last ? (last.is_deleted ? null : last.message_text) : null,
        lastMessageAt: c.last_message_at,
        lastMessageMine: last ? last.sender_id === userId : false,
        unread: unread.get(c.conversation_id.toString()) ?? 0,
      };
    });

    return {
      items,
      unreadTotal: items.reduce((sum, i) => sum + i.unread, 0),
    };
  }

  /** Just the badge — cheap enough to poll. */
  async unreadTotal(userId: bigint, role: user_role): Promise<number> {
    const rows =
      role === user_role.PARTNER
        ? await this.prisma.$queryRaw<{ total: bigint }[]>`
            SELECT count(*)::bigint AS total
            FROM messages m
            JOIN conversations c  ON c.conversation_id = m.conversation_id
            JOIN properties    p  ON p.property_id     = c.property_id
            JOIN partners      pt ON pt.partner_id     = p.partner_id
            LEFT JOIN conversation_reads r
                   ON r.conversation_id = c.conversation_id AND r.user_id = ${userId}
            WHERE pt.user_id = ${userId}
              AND m.sender_id <> ${userId}
              AND NOT m.is_deleted
              AND m.message_id > COALESCE(r.last_read_message_id, 0)
          `
        : await this.prisma.$queryRaw<{ total: bigint }[]>`
            SELECT count(*)::bigint AS total
            FROM messages m
            JOIN conversations c ON c.conversation_id = m.conversation_id
            LEFT JOIN conversation_reads r
                   ON r.conversation_id = c.conversation_id AND r.user_id = ${userId}
            WHERE c.customer_id = ${userId}
              AND m.sender_id <> ${userId}
              AND NOT m.is_deleted
              AND m.message_id > COALESCE(r.last_read_message_id, 0)
          `;
    return Number(rows[0]?.total ?? 0);
  }

  private async unreadPerConversation(userId: bigint, ids: bigint[]) {
    const rows = await this.prisma.$queryRaw<{ conversation_id: bigint; unread: bigint }[]>`
      SELECT m.conversation_id, count(*)::bigint AS unread
      FROM messages m
      LEFT JOIN conversation_reads r
             ON r.conversation_id = m.conversation_id AND r.user_id = ${userId}
      WHERE m.conversation_id = ANY(${ids})
        AND m.sender_id <> ${userId}
        AND NOT m.is_deleted
        AND m.message_id > COALESCE(r.last_read_message_id, 0)
      GROUP BY m.conversation_id
    `;
    return new Map(rows.map((r) => [r.conversation_id.toString(), Number(r.unread)]));
  }

  // ── starting a thread ─────────────────────────────────────────────────────

  /**
   * Opens a conversation with a property, or returns the one already open.
   *
   * Only a guest starts one: a property messaging someone who never contacted
   * them is how a booking platform becomes a spam channel.
   */
  async start(customerId: bigint, propertyId: bigint, bookingId?: bigint) {
    const property = await this.prisma.properties.findFirst({
      where: { property_id: propertyId, deleted_at: null, partners: { status: 'verified' } },
      select: { property_id: true },
    });
    if (!property) throw new NotFoundException(`ບໍ່ພົບທີ່ພັກ #${propertyId} · Property not found`);

    if (bookingId !== undefined) {
      const booking = await this.prisma.bookings.findFirst({
        where: { booking_id: bookingId, customer_id: customerId, property_id: propertyId },
        select: { booking_id: true },
      });
      if (!booking) {
        throw new BadRequestException(
          'ການຈອງນີ້ບໍ່ແມ່ນຂອງທ່ານ ຫຼື ບໍ່ແມ່ນຂອງທີ່ພັກນີ້ · That booking does not match',
        );
      }
    }

    // One open thread per guest and property. A second would split the history
    // in half and leave half of it unread forever.
    const existing = await this.prisma.conversations.findFirst({
      where: {
        customer_id: customerId,
        property_id: propertyId,
        status: conversation_status.open,
      },
    });
    if (existing) return this.detail(customerId, user_role.CUSTOMER, existing.conversation_id);

    const created = await this.prisma.conversations.create({
      data: {
        customer_id: customerId,
        property_id: propertyId,
        booking_id: bookingId ?? null,
      },
    });
    return this.detail(customerId, user_role.CUSTOMER, created.conversation_id);
  }

  async detail(userId: bigint, role: user_role, conversationId: bigint) {
    const { conversation } = await this.require(userId, role, conversationId);
    const customer = await this.prisma.users.findUniqueOrThrow({
      where: { user_id: conversation.customer_id },
      include: { user_profiles: { select: { full_name: true } } },
    });

    return {
      id: conversation.conversation_id.toString(),
      propertyId: conversation.properties.property_id.toString(),
      property: conversation.properties.property_name,
      customerName: customer.user_profiles?.full_name ?? customer.email,
      bookingId: conversation.booking_id?.toString() ?? null,
      status: conversation.status,
      lastMessageAt: conversation.last_message_at,
      createdAt: conversation.created_at,
    };
  }

  // ── messages ──────────────────────────────────────────────────────────────

  /**
   * A page of messages.
   *
   * `since` is a message id, not a timestamp: two messages written in the same
   * millisecond would make a time cursor either skip one or repeat it. Polling
   * therefore asks for "everything after id N" and gets exactly that.
   */
  async messages(
    userId: bigint,
    role: user_role,
    conversationId: bigint,
    opts: { since?: bigint; limit?: number } = {},
  ) {
    await this.require(userId, role, conversationId);
    const limit = Math.min(opts.limit ?? 50, 100);

    const rows = await this.prisma.messages.findMany({
      where: {
        conversation_id: conversationId,
        ...(opts.since ? { message_id: { gt: opts.since } } : {}),
      },
      // Newest first when paging back through history, then reversed so the
      // caller always receives them in reading order.
      orderBy: { message_id: opts.since ? 'asc' : 'desc' },
      take: limit,
      include: {
        users: { include: { user_profiles: { select: { full_name: true } } } },
      },
    });

    const ordered = opts.since ? rows : rows.reverse();

    return {
      items: ordered.map((m) => ({
        id: m.message_id.toString(),
        conversationId: m.conversation_id.toString(),
        senderId: m.sender_id.toString(),
        senderName: m.users.user_profiles?.full_name ?? m.users.email,
        mine: m.sender_id === userId,
        type: m.message_type,
        // A deleted message keeps its place so the thread still reads in order.
        text: m.is_deleted ? null : m.message_text,
        isDeleted: m.is_deleted,
        isEdited: m.is_edited,
        replyToId: m.reply_to_message_id?.toString() ?? null,
        createdAt: m.created_at,
      })),
    };
  }

  async send(
    userId: bigint,
    role: user_role,
    conversationId: bigint,
    input: { text: string; replyToId?: bigint },
  ) {
    const { conversation, isAdmin } = await this.require(userId, role, conversationId);

    // An admin can read a thread but not speak in it — a message from
    // "the property" that the property never wrote would be worse than useless
    // in a dispute.
    if (isAdmin) {
      throw new ForbiddenException(
        'ຜູ້ດູແລອ່ານໄດ້ ແຕ່ສົ່ງຂໍ້ຄວາມແທນຄູ່ສົນທະນາບໍ່ໄດ້ · Admins may read but not post',
      );
    }
    if (conversation.status === conversation_status.closed) {
      throw new BadRequestException('ການສົນທະນານີ້ປິດແລ້ວ · This conversation is closed');
    }

    const text = input.text.trim();
    if (!text) throw new BadRequestException('ຂໍ້ຄວາມຫວ່າງເປົ່າ · The message is empty');

    if (input.replyToId !== undefined) {
      const parent = await this.prisma.messages.findFirst({
        where: { message_id: input.replyToId, conversation_id: conversationId },
        select: { message_id: true },
      });
      if (!parent) {
        throw new BadRequestException('ຂໍ້ຄວາມທີ່ຕອບກັບບໍ່ຢູ່ໃນການສົນທະນານີ້ · Reply target not in this thread');
      }
    }

    // The trigger updates conversations.last_message_* — do not set them here.
    const message = await this.prisma.messages.create({
      data: {
        conversation_id: conversationId,
        sender_id: userId,
        message_type: message_type.text,
        message_text: text,
        reply_to_message_id: input.replyToId ?? null,
      },
      include: { users: { include: { user_profiles: { select: { full_name: true } } } } },
    });

    // Sending is already committed, so the notification takes no transaction:
    // a failure to notify must not lose the message.
    await this.notifications.send(null, {
      userId: this.counterpart(conversation, userId),
      templateCode: 'new_message',
      vars: {
        sender: message.users.user_profiles?.full_name ?? message.users.email,
        preview: text.length > 60 ? `${text.slice(0, 60)}…` : text,
      },
      referenceType: 'conversation',
      referenceId: conversationId,
    });

    return {
      id: message.message_id.toString(),
      conversationId: conversationId.toString(),
      senderId: userId.toString(),
      senderName: message.users.user_profiles?.full_name ?? message.users.email,
      mine: true,
      type: message.message_type,
      text: message.message_text,
      isDeleted: false,
      isEdited: false,
      replyToId: message.reply_to_message_id?.toString() ?? null,
      createdAt: message.created_at,
    };
  }

  /** Soft delete, and only your own. The row stays so the thread still reads. */
  async remove(userId: bigint, role: user_role, conversationId: bigint, messageId: bigint) {
    await this.require(userId, role, conversationId);

    const { count } = await this.prisma.messages.updateMany({
      where: {
        message_id: messageId,
        conversation_id: conversationId,
        sender_id: userId,
        is_deleted: false,
      },
      data: { is_deleted: true, deleted_at: new Date() },
    });
    if (!count) throw new NotFoundException('ບໍ່ພົບຂໍ້ຄວາມ · Message not found');
    return { id: messageId.toString(), deleted: true };
  }

  // ── read cursor ───────────────────────────────────────────────────────────

  /**
   * Moves the caller's read cursor to the newest message in the thread.
   *
   * `GREATEST` on update, because two devices reading at once must not move the
   * cursor backwards and resurrect messages the guest has already seen.
   */
  async markRead(userId: bigint, role: user_role, conversationId: bigint) {
    await this.require(userId, role, conversationId);

    const newest = await this.prisma.messages.findFirst({
      where: { conversation_id: conversationId },
      orderBy: { message_id: 'desc' },
      select: { message_id: true },
    });
    if (!newest) return { unread: 0 };

    await this.prisma.$executeRaw`
      INSERT INTO conversation_reads (conversation_id, user_id, last_read_message_id, read_at)
      VALUES (${conversationId}, ${userId}, ${newest.message_id}, now())
      ON CONFLICT (conversation_id, user_id) DO UPDATE
        SET last_read_message_id =
              GREATEST(conversation_reads.last_read_message_id, EXCLUDED.last_read_message_id),
            read_at    = now(),
            updated_at = now()
    `;
    return { unread: 0 };
  }

  /** Closing a thread stops new messages; the history stays readable. */
  async setStatus(
    userId: bigint,
    role: user_role,
    conversationId: bigint,
    status: conversation_status,
  ) {
    await this.require(userId, role, conversationId);
    const updated = await this.prisma.conversations.update({
      where: { conversation_id: conversationId },
      data: { status },
    });
    return { id: updated.conversation_id.toString(), status: updated.status };
  }
}
