import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { recalcPropertyRating } from '../../common/reviews';

export interface ListReviewsQuery extends PaginationDto {
  flagged?: boolean;
  hidden?: boolean;
  stars?: number;
}

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListReviewsQuery) {
    const where: Prisma.reviewsWhereInput = {};
    if (dto.flagged !== undefined) where.is_flagged = dto.flagged;
    if (dto.hidden !== undefined) where.is_hidden = dto.hidden;
    if (dto.stars !== undefined) where.stars = dto.stars;
    if (dto.q) {
      const q = dto.q.trim();
      where.OR = [
        { text: { contains: q, mode: 'insensitive' } },
        { properties: { name: { contains: q, mode: 'insensitive' } } },
        { bookings: { users: { full_name: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.reviews.findMany({
        where,
        skip: dto.skip,
        take: dto.limit,
        // Flagged reviews first — they are the ones needing a decision.
        orderBy: [{ is_flagged: 'desc' }, { id: 'desc' }],
        include: {
          properties: { select: { id: true, name: true } },
          bookings: {
            select: {
              id: true,
              check_in: true,
              check_out: true,
              users: { select: { id: true, full_name: true } },
            },
          },
        },
      }),
      this.prisma.reviews.count({ where }),
    ]);

    return paged(
      rows.map((r) => ({
        id: r.id,
        stars: r.stars,
        text: r.text,
        isHidden: r.is_hidden,
        isFlagged: r.is_flagged,
        property: r.properties.name,
        propertyId: r.properties.id,
        guest: r.bookings.users.full_name,
        bookingId: r.bookings.id,
        stayedAt: r.bookings.check_out,
      })),
      total,
      dto,
    );
  }

  async counts() {
    const [total, flagged, hidden] = await Promise.all([
      this.prisma.reviews.count(),
      this.prisma.reviews.count({ where: { is_flagged: true } }),
      this.prisma.reviews.count({ where: { is_hidden: true } }),
    ]);
    const avg = await this.prisma.reviews.aggregate({
      where: { is_hidden: false },
      _avg: { stars: true },
    });
    return {
      total,
      flagged,
      hidden,
      averageStars: avg._avg.stars ? Number(avg._avg.stars.toFixed(2)) : null,
    };
  }

  /**
   * Hide or unhide a review.
   *
   * Hiding also removes it from the property's public rating, so the average
   * and count are recalculated in the same transaction. Skipping that step
   * would leave a hidden 1-star review still dragging the score down.
   */
  async setHidden(id: bigint, hidden: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.reviews.findUnique({ where: { id } });
      if (!review) throw new NotFoundException(`ບໍ່ພົບຮີວິວ #${id} · Review not found`);

      const updated = await tx.reviews.update({
        where: { id },
        // Resolving a flagged review clears the flag; it has been dealt with.
        data: { is_hidden: hidden, is_flagged: false },
      });

      await recalcPropertyRating(tx, review.property_id);
      return updated;
    });
  }

  async setFlagged(id: bigint, flagged: boolean) {
    const exists = await this.prisma.reviews.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException(`ບໍ່ພົບຮີວິວ #${id} · Review not found`);
    return this.prisma.reviews.update({ where: { id }, data: { is_flagged: flagged } });
  }
}
