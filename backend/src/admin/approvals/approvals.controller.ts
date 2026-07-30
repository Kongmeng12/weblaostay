import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApprovalsService } from './approvals.service';
import { Audit } from '../../common/decorators';

class RejectDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@Controller('admin/approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  list() {
    return this.approvals.list();
  }

  @Get('counts')
  counts() {
    return this.approvals.counts();
  }

  @Patch(':id/approve')
  @Audit('approve_partner', 'partners:id')
  approve(@Param('id') id: string) {
    return this.approvals.approve(BigInt(id));
  }

  @Patch(':id/reject')
  @Audit('reject_partner', 'partners:id')
  reject(@Param('id') id: string, @Body() dto: RejectDto) {
    return this.approvals.reject(BigInt(id), dto.reason);
  }
}
