import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { PayoutsService } from './payouts.service';
import { Audit, Roles } from '../../common/decorators';
import { MONEY_ROLES } from '../../common/roles';
import { PAYOUT_STATUS } from '../../common/money';

class GenerateDto {
  /** Any date inside the target week; it is snapped to the Monday. */
  @IsOptional()
  @IsISO8601()
  periodStart?: string;
}

class ListPayoutsDto {
  @IsOptional()
  @IsIn(Object.values(PAYOUT_STATUS))
  status?: string;
}

/**
 * Everything under payouts moves money, so the whole controller is limited to
 * super_admin and finance. Staff get a 403.
 */
@Controller('admin/payouts')
@Roles(...MONEY_ROLES)
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get()
  list(@Query() query: ListPayoutsDto) {
    return this.payouts.list(query.status);
  }

  @Post('generate')
  @Audit('payout_generate')
  generate(@Body() dto: GenerateDto) {
    return this.payouts.generate(dto.periodStart);
  }

  @Patch(':id/pay')
  @Audit('payout_pay', 'payouts:id')
  pay(@Param('id') id: string) {
    return this.payouts.pay(BigInt(id));
  }

  @Post('pay-all')
  @HttpCode(200)
  @Audit('payout_pay_all')
  payAll() {
    return this.payouts.payAll();
  }
}
