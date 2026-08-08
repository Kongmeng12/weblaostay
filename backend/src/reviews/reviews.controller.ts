import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { user_role } from '@prisma/client';
import { ReviewsService } from './reviews.service';
import { Audit, CurrentUser, Public, Roles, type AuthedUser } from '../common/decorators';

class ReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @IsOptional()
  @IsString()
  parentReplyId?: string;
}

class ReviewImageDto {
  @IsString()
  @MaxLength(500)
  url!: string;
}

/**
 * The reply thread on a review, readable by anyone.
 *
 * A guest choosing a property reads the complaints *and* what the host said
 * back — hiding the reply behind a login would only show them half the story.
 */
@Controller('reviews')
export class PublicReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get(':id')
  thread(@Param('id') id: string) {
    return this.reviews.thread(BigInt(id));
  }
}

/**
 * Replying.
 *
 * One controller for all three roles rather than three copies: the service
 * decides who is allowed to speak on a given review, and that decision should
 * live in exactly one place.
 */
@Controller('reviews/:id/replies')
@Roles(user_role.CUSTOMER, user_role.PARTNER, user_role.ADMIN)
export class ReviewRepliesController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  @Audit('review_reply', 'reviews', 'review_replies')
  reply(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() dto: ReplyDto) {
    return this.reviews.reply(user, BigInt(id), {
      text: dto.text,
      parentReplyId: dto.parentReplyId ? BigInt(dto.parentReplyId) : undefined,
    });
  }

  @Delete(':replyId')
  @Audit('review_reply_delete', 'reviews', 'review_replies')
  remove(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Param('replyId') replyId: string,
  ) {
    return this.reviews.removeReply(user, BigInt(id), BigInt(replyId));
  }
}

/** Photos on a review — the guest's own, and only theirs. */
@Controller('customer/reviews/:id/images')
@Roles(user_role.CUSTOMER)
export class ReviewImagesController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  add(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() dto: ReviewImageDto) {
    return this.reviews.addImage(user.userId, BigInt(id), dto.url);
  }

  @Delete(':imageId')
  remove(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.reviews.removeImage(user.userId, BigInt(id), BigInt(imageId));
  }
}
