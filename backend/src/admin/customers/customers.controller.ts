import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { CustomersService } from './customers.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { Audit } from '../../common/decorators';
import { USER_STATUS } from '../../common/money';

const STATUSES = Object.values(USER_STATUS);

class ListCustomersDto extends PaginationDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;
}

class SetStatusDto {
  @IsIn(STATUSES)
  status!: string;
}

@Controller('admin/customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Query() query: ListCustomersDto) {
    return this.customers.list(query);
  }

  @Get('summary')
  summary() {
    return this.customers.summary();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customers.findOne(BigInt(id));
  }

  @Patch(':id/status')
  @Audit('customer_status_change', 'users:id')
  setStatus(@Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.customers.setStatus(BigInt(id), dto.status);
  }
}
