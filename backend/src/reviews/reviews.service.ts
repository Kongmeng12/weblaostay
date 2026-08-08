import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { user_role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { rateOf } from '../common/money';

/**
 * Replies to reviews, and the photos guests attach to them.
 *
 * A public reply is the property's only right of response. `review_replies`
 * accepts any `user_id`, so *who may reply* is enforced here: the host of the
 * reviewed property, the guest who wrote it, and admins. Without that check a
 * stranger could answer on a property's behalf.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The review plus its reply thread. Used by the property page and both apps. */
  async thread(reviewId: bigint) {
    const review = await this.prisma.reviews.findUnique({
      where: { review_id: reviewId },
      include: {
        users: { include: { user_profiles: { select: { full_name: true } } } },
        properties: { select: { property_id: true, property_name: true, partner_id: true } },
        review_images: { orderBy: { display_order: 'asc' } },
        review_replies: {
          orderBy: { created_at: 'asc' },
          include: { users: { include: { user_profiles: { select: { full_name: true } } } } },
        },
      },
    });
    if (!review) throw new NotFoundException(`ບໍ່ພົບຮີວິວ #${reviewId} · Review not found`);

    return {
      id: review.review_id.toString(),
      propertyId: review.properties.property_id.toString(),
      property: review.properties.property_name,
      stars: rateOf(review.overall_rating),
      title: review.title,
      comment: review.comment,
      guest: review.users.user_profiles?.full_name ?? '—',
      status: review.status,
      createdAt: review.created_at,
      images: review.review_images.map((i) => ({
        id: i.review_image_id.toString(),
        url: i.image_url,
        order: i.display_order,
      })),
      replies: this.nest(review.review_replies),
    };
  }

  /**
   * Builds the reply tree from the flat `parent_reply_id` rows.
   *
   * Depth is whatever the data holds — the schema allows any — so a client that
   * only wants to render two levels flattens the rest itself. Rows arrive
   * oldest-first, and a child is always written after its parent, so one pass
   * is enough: the parent is already in the map by the time a child needs it.
   */
  private nest(
    rows: {
      reply_id: bigint;
      parent_reply_id: bigint | null;
      reply_text: string;
      created_at: Date;
      user_id: bigint;
      users: { email: string; user_profiles: { full_name: string | null } | null };
    }[],
  ) {
    // Named rather than inferred: the type refers to itself through `children`,
    // which TypeScript cannot resolve from a self-referencing arrow function.
    interface ReplyNode {
      id: string;
      text: string;
      author: string;
      authorId: string;
      createdAt: Date;
      children: ReplyNode[];
    }

    const view = (r: (typeof rows)[number]): ReplyNode => ({
      id: r.reply_id.toString(),
      text: r.reply_text,
      author: r.users.user_profiles?.full_name ?? r.users.email,
      authorId: r.user_id.toString(),
      createdAt: r.created_at,
      children: [],
    });

    const byId = new Map(rows.map((r) => [r.reply_id.toString(), view(r)]));
    const roots: ReplyNode[] = [];

    for (const row of rows) {
      const node = byId.get(row.reply_id.toString())!;
      const parent = row.parent_reply_id ? byId.get(row.parent_reply_id.toString()) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  /**
   * Posts a reply.
   *
   * The guest is told when the property answers — that is the whole point of a
   * public reply, and they will not be watching the page.
   */
  async reply(
    user: { userId: bigint; role: user_role; partnerId: bigint | null },
    reviewId: bigint,
    input: { text: string; parentReplyId?: bigint },
  ) {
    const review = await this.prisma.reviews.findUnique({
      where: { review_id: reviewId },
      include: { properties: { select: { partner_id: true, property_name: true } } },
    });
    if (!review) throw new NotFoundException(`ບໍ່ພົບຮີວິວ #${reviewId} · Review not found`);

    const isHost =
      user.role === user_role.PARTNER && user.partnerId === review.properties.partner_id;
    const isAuthor = review.customer_id === user.userId;
    const isAdmin = user.role === user_role.ADMIN;

    if (!isHost && !isAuthor && !isAdmin) {
      throw new ForbiddenException(
        'ຕອບໄດ້ສະເພາະເຈົ້າຂອງທີ່ພັກ ຫຼື ຜູ້ຂຽນຮີວິວ · Only the host or the reviewer may reply',
      );
    }

    const text = input.text.trim();
    if (!text) throw new BadRequestException('ຂໍ້ຄວາມຫວ່າງເປົ່າ · The reply is empty');

    if (input.parentReplyId !== undefined) {
      const parent = await this.prisma.review_replies.findFirst({
        where: { reply_id: input.parentReplyId, review_id: reviewId },
        select: { reply_id: true },
      });
      if (!parent) {
        throw new BadRequestException(
          'ຂໍ້ຄວາມທີ່ຕອບກັບບໍ່ຢູ່ໃນຮີວິວນີ້ · Reply target is not on this review',
        );
      }
    }

    const created = await this.prisma.review_replies.create({
      data: {
        review_id: reviewId,
        user_id: user.userId,
        reply_text: text,
        parent_reply_id: input.parentReplyId ?? null,
      },
      select: { reply_id: true },
    });

    // Only when the host answers — a guest replying to their own review does
    // not need telling about it.
    if (isHost) {
      await this.notifications.send(null, {
        userId: review.customer_id,
        templateCode: 'review_replied',
        vars: { property: review.properties.property_name },
        referenceType: 'review',
        referenceId: reviewId,
      });
    }

    // The whole thread, because that is what the caller re-renders — plus the
    // id of the row just written, which is otherwise unrecoverable: `id` on the
    // thread is the review's, and two replies with the same text are
    // indistinguishable. Without it a client cannot delete what it just posted.
    return { ...(await this.thread(reviewId)), replyId: created.reply_id.toString() };
  }

  /** Removes a reply. Its follow-ups cascade with it, per the schema. */
  async removeReply(
    user: { userId: bigint; role: user_role },
    reviewId: bigint,
    replyId: bigint,
  ) {
    const reply = await this.prisma.review_replies.findFirst({
      where: { reply_id: replyId, review_id: reviewId },
      select: { user_id: true },
    });
    if (!reply) throw new NotFoundException('ບໍ່ພົບຄຳຕອບ · Reply not found');

    if (reply.user_id !== user.userId && user.role !== user_role.ADMIN) {
      throw new ForbiddenException('ລຶບໄດ້ສະເພາະຄຳຕອບຂອງຕົນເອງ · You may only delete your own reply');
    }

    await this.prisma.review_replies.delete({ where: { reply_id: replyId } });
    return this.thread(reviewId);
  }

  /**
   * Attaches a photo to a review.
   *
   * Only the guest who wrote it, and only while it is theirs to change — a
   * property adding its own pictures to someone else's review would be
   * misleading.
   */
  async addImage(customerId: bigint, reviewId: bigint, url: string) {
    const review = await this.prisma.reviews.findFirst({
      where: { review_id: reviewId, customer_id: customerId },
      select: { review_id: true },
    });
    if (!review) throw new NotFoundException(`ບໍ່ພົບຮີວິວ #${reviewId} · Review not found`);

    const existing = await this.prisma.review_images.count({ where: { review_id: reviewId } });
    if (existing >= 6) {
      throw new BadRequestException('ຮູບໄດ້ສູງສຸດ 6 ຮູບຕໍ່ຮີວິວ · At most 6 photos per review');
    }

    await this.prisma.review_images.create({
      data: { review_id: reviewId, image_url: url, display_order: existing },
    });
    return this.thread(reviewId);
  }

  async removeImage(customerId: bigint, reviewId: bigint, imageId: bigint) {
    const { count } = await this.prisma.review_images.deleteMany({
      where: { review_image_id: imageId, review_id: reviewId, reviews: { customer_id: customerId } },
    });
    if (!count) throw new NotFoundException('ບໍ່ພົບຮູບ · Photo not found');
    return this.thread(reviewId);
  }
}
