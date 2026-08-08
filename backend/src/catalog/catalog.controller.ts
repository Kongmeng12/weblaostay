import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Public } from '../common/decorators';
import {
  CalendarQueryDto,
  DistrictQueryDto,
  SearchDto,
  StayRangeDto,
} from './catalog.dto';

/**
 * The public catalogue. Browsing needs no account — a guest has to see prices
 * before deciding to register — so every route here is @Public().
 */
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('properties')
  search(@Query() query: SearchDto) {
    return this.catalog.search(query);
  }

  @Public()
  @Get('properties/:id')
  findOne(@Param('id') id: string, @Query() query: StayRangeDto) {
    return this.catalog.findOne(BigInt(id), query.checkIn, query.checkOut);
  }

  @Public()
  @Get('properties/:id/calendar')
  calendar(@Param('id') id: string, @Query() query: CalendarQueryDto) {
    return this.catalog.calendar(BigInt(id), query);
  }

  @Public()
  @Get('locations/provinces')
  provinces() {
    return this.catalog.provinces();
  }

  @Public()
  @Get('locations/districts')
  districts(@Query() query: DistrictQueryDto) {
    return this.catalog.districts(query.provinceId);
  }

  @Public()
  @Get('amenities')
  amenities() {
    return this.catalog.amenities();
  }
}
