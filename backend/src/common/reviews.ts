import { Prisma } from '@prisma/client';

/**
 * Recomputes `properties.rating` / `review_count` from visible reviews only.
 *
 * Called from three places — an admin hiding a review, an admin unhiding one,
 * and a guest posting one — so it lives here rather than in any one of them.
 * Always run it inside the same transaction as the write that changed the
 * reviews, or the score will disagree with the rows it is derived from.
 */
export async function recalcPropertyRating(
  tx: Prisma.TransactionClient,
  propertyId: bigint,
): Promise<void> {
  const agg = await tx.reviews.aggregate({
    where: { property_id: propertyId, is_hidden: false },
    _avg: { stars: true },
    _count: true,
  });

  await tx.properties.update({
    where: { id: propertyId },
    data: {
      rating: new Prisma.Decimal((agg._avg.stars ?? 0).toFixed(2)),
      review_count: agg._count,
    },
  });
}
