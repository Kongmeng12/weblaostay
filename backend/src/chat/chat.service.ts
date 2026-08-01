import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ACTOR } from '../common/actors';
import { SENDER_TYPE, bookingCode } from '../common/money';
import type { AuthedActor } from '../common/decorators';

/**
 * Per-booking chat between the guest, the property and support.
 *
 * Delivery is by polling: `GET …/messages?since=<id>` returns everything newer
 * than the cursor the client already holds. That keeps one code path for the
 * web admin, the Flutter app and the smoke test, works through any proxy, and
 * needs no socket server. The data model is the same one a WebSocket would
 * use, so moving to push later changes the transport and nothing else.
 */
@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A booking is a private conversation between exactly three parties: the
   * guest who booked it, the partner who owns the property, and admins.
   * Everyone else gets a 404 — not a 403, which would confirm the booking
   * exists.
   */
  async assertParticipant(actor: AuthedActor, bookingId: bigint) {
    const booking = await this.prisma.bookings.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        user_id: true,
        properties: { select: { partner_id: true } },
      },
    });
    if (!booking) throw new NotFoundException(`ບໍ່ພົບການຈອງ #${bookingId} · Booking not found`);

    const allowed =
      actor.actorType === ACTOR.ADMIN ||
      (actor.actorType === ACTOR.USER && booking.user_id === actor.id) ||
      (actor.actorType === ACTOR.PARTNER && booking.properties.partner_id === actor.id);

    if (!allowed) {
      throw new NotFoundException(`ບໍ່ພົບການຈອງ #${bookingId} · Booking not found`);
    }
    return booking;
  }

  /**
   * Messages after `since`, oldest first.
   *
   * The cursor is the message id, not a timestamp: two messages written in the
   * same millisecond would make a time cursor either skip one or repeat one.
   */
  async list(actor: AuthedActor, bookingId: bigint, since?: bigint, limit = 100) {
    await this.assertParticipant(actor, bookingId);

    const rows = await this.prisma.chat_messages.findMany({
      where: { booking_id: bookingId, ...(since ? { id: { gt: since } } : {}) },
      orderBy: { id: 'asc' },
      take: limit,
    });

    return {
      bookingId,
      code: bookingCode(bookingId),
      messages: rows.map((m) => ({
        id: m.id,
        senderType: m.sender_type,
        body: m.body,
        sentAt: m.sent_at,
        readAt: m.read_at,
        mine: m.sender_type === senderTypeFor(actor),
      })),
      // What the client should pass as `since` next time. Unchanged when the
      // page was empty, so an idle poll does not lose its place.
      cursor: rows.length ? rows[rows.length - 1].id : (since ?? null),
    };
  }

  async send(actor: AuthedActor, bookingId: bigint, body: string) {
    await this.assertParticipant(actor, bookingId);

    // The sender is taken from the token, never from the request body — anyone
    // could otherwise post a message signed "admin".
    const message = await this.prisma.chat_messages.create({
      data: {
        booking_id: bookingId,
        sender_type: senderTypeFor(actor),
        body: body.trim(),
      },
    });

    return {
      id: message.id,
      senderType: message.sender_type,
      body: message.body,
      sentAt: message.sent_at,
      mine: true,
    };
  }

  /** Marks the other side's messages read, for the unread badge. */
  async markRead(actor: AuthedActor, bookingId: bigint) {
    await this.assertParticipant(actor, bookingId);

    const { count } = await this.prisma.chat_messages.updateMany({
      where: {
        booking_id: bookingId,
        sender_type: { not: senderTypeFor(actor) },
        read_at: null,
      },
      data: { read_at: new Date() },
    });
    return { read: count };
  }

  /** Unread counts per booking, for the conversation list. */
  async unread(actor: AuthedActor) {
    const bookings = await this.bookingScope(actor);
    if (!bookings.length) return { total: 0, byBooking: [] };

    const rows = await this.prisma.chat_messages.groupBy({
      by: ['booking_id'],
      where: {
        booking_id: { in: bookings },
        sender_type: { not: senderTypeFor(actor) },
        read_at: null,
      },
      _count: true,
    });

    return {
      total: rows.reduce((sum, r) => sum + r._count, 0),
      byBooking: rows.map((r) => ({
        bookingId: r.booking_id,
        code: bookingCode(r.booking_id),
        unread: r._count,
      })),
    };
  }

  /** Every booking this actor may see. Admins are capped to the recent ones. */
  private async bookingScope(actor: AuthedActor): Promise<bigint[]> {
    const where =
      actor.actorType === ACTOR.USER
        ? { user_id: actor.id }
        : actor.actorType === ACTOR.PARTNER
          ? { properties: { partner_id: actor.id } }
          : {};

    const rows = await this.prisma.bookings.findMany({
      where,
      select: { id: true },
      orderBy: { id: 'desc' },
      take: actor.actorType === ACTOR.ADMIN ? 500 : 200,
    });
    return rows.map((r) => r.id);
  }
}

/** `chat_messages.sender_type` uses the same three strings as ACTOR. */
function senderTypeFor(actor: AuthedActor): string {
  switch (actor.actorType) {
    case ACTOR.USER:
      return SENDER_TYPE.USER;
    case ACTOR.PARTNER:
      return SENDER_TYPE.PARTNER;
    default:
      return SENDER_TYPE.ADMIN;
  }
}
