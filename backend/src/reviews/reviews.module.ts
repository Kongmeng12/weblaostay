import { Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import {
  PublicReviewsController,
  ReviewImagesController,
  ReviewRepliesController,
} from './reviews.controller';

/**
 * Review replies and photos.
 *
 * Writing a review still lives in the customer controller, because it is part
 * of finishing a stay. What happens to a review afterwards — the host's answer,
 * the guest's pictures — is its own thing and belongs here.
 */
@Module({
  controllers: [PublicReviewsController, ReviewRepliesController, ReviewImagesController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
