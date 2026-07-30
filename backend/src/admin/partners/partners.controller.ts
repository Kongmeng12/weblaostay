import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PartnersService } from './partners.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { Audit, Roles } from '../../common/decorators';
import { MONEY_ROLES } from '../../common/roles';
import { PARTNER_STATUS } from '../../common/money';

class ListPartnersDto extends PaginationDto {
  @IsOptional()
  @IsIn(Object.values(PARTNER_STATUS))
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;
}

class UpdatePartnerDto {
  @IsOptional()
  @IsIn(Object.values(PARTNER_STATUS))
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankAccount?: string;
}

@Controller('admin/partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  list(@Query() query: ListPartnersDto) {
    return this.partners.list(query);
  }

  @Get('provinces')
  provinces() {
    return this.partners.provinces();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.partners.findOne(BigInt(id));
  }

  /** Editing a commission rate or bank details is a finance action. */
  @Patch(':id')
  @Roles(...MONEY_ROLES)
  @Audit('partner_update', 'partners:id')
  update(@Param('id') id: string, @Body() dto: UpdatePartnerDto) {
    return this.partners.update(BigInt(id), dto);
  }
}
