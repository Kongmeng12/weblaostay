import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PromosService, PROMO_TYPE, type PromoType } from './promos.service';
import { Audit } from '../../common/decorators';

class CreatePromoDto {
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'ໂຄ້ດໃຊ້ໄດ້ສະເພາະ A–Z, 0–9, - ແລະ _ · Letters, digits, hyphen and underscore only',
  })
  code!: string;

  @IsIn(Object.values(PROMO_TYPE))
  type!: PromoType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  value!: number;

  @IsISO8601()
  expiresAt!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class UpdatePromoDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/)
  code?: string;

  @IsOptional()
  @IsIn(Object.values(PROMO_TYPE))
  type?: PromoType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  value?: number;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class ListPromosDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  activeOnly?: boolean;
}

@Controller('admin/promos')
export class PromosController {
  constructor(private readonly promos: PromosService) {}

  @Get()
  list(@Query() query: ListPromosDto) {
    return this.promos.list(!query.activeOnly);
  }

  @Post()
  @Audit('promo_create')
  create(@Body() dto: CreatePromoDto) {
    return this.promos.create(dto);
  }

  @Patch(':id')
  @Audit('promo_update', 'promos:id')
  update(@Param('id') id: string, @Body() dto: UpdatePromoDto) {
    return this.promos.update(BigInt(id), dto);
  }

  @Delete(':id')
  @Audit('promo_delete', 'promos:id')
  remove(@Param('id') id: string) {
    return this.promos.remove(BigInt(id));
  }
}
