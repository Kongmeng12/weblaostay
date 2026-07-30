import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

/** Shared query params for every admin list endpoint. */
export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  /** Free-text search. Each endpoint decides which columns it covers. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export function paged<T>(items: T[], total: number, dto: PaginationDto): Paged<T> {
  return {
    items,
    total,
    page: dto.page,
    limit: dto.limit,
    pages: Math.max(1, Math.ceil(total / dto.limit)),
  };
}
