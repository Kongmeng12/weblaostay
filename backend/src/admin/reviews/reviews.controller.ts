import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ReviewsService } from './reviews.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { Audit } from '../../common/decorators';

/** "?flagged=true" arrives as a string; turn it into a real boolean. */
const toBool = () =>
  Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true));

class ListReviewsDto extends PaginationDto {
  @IsOptional()
  @toBool()
  @IsBoolean()
  flagged?: boolean;

  @IsOptional()
  @toBool()
  @IsBoolean()
  hidden?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  stars?: number;
}

@Controller('admin/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Query() query: ListReviewsDto) {
    return this.reviews.list(query);
  }

  @Get('counts')
  counts() {
    return this.reviews.counts();
  }

  @Patch(':id/hide')
  @Audit('review_hide', 'reviews:id')
  hide(@Param('id') id: string) {
    return this.reviews.setHidden(BigInt(id), true);
  }

  @Patch(':id/unhide')
  @Audit('review_unhide', 'reviews:id')
  unhide(@Param('id') id: string) {
    return this.reviews.setHidden(BigInt(id), false);
  }

  @Patch(':id/flag')
  @Audit('review_flag', 'reviews:id')
  flag(@Param('id') id: string) {
    return this.reviews.setFlagged(BigInt(id), true);
  }
}
