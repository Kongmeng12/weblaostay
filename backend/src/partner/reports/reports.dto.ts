import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { DateRangeDto } from '../partner.dto';

export type ReportBucket = 'day' | 'week' | 'month';

/**
 * Shared by every `/partner/reports/*` route. `propertyId` narrows a
 * multi-property partner down to one property; omitted, a report covers every
 * property the partner owns. `bucket` controls the granularity of `series` —
 * reports where re-bucketing isn't meaningful (payouts, cancellations,
 * reviews, promotions) just ignore it and always bucket by day.
 */
export class ReportQueryDto extends DateRangeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  propertyId?: number;

  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  bucket?: ReportBucket;
}
