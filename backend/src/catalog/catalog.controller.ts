import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { user_role } from '@prisma/client';
import { CatalogService } from './catalog.service';
import { Audit, Public, Roles } from '../common/decorators';
import {
  CalendarQueryDto,
  DistrictQueryDto,
  ReorderProvincesDto,
  RoomAvailabilityQueryDto,
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
  @Get('room-types/:id/rooms')
  roomTypeRooms(@Param('id') id: string, @Query() query: RoomAvailabilityQueryDto) {
    return this.catalog.roomTypeRooms(BigInt(id), query);
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

/** Reordering the Home "Explore regions" rail — see webadmin's "ຮູບແຂວງ" page. */
@Controller('admin/locations/provinces')
@Roles(user_role.ADMIN)
export class AdminLocationsController {
  constructor(private readonly catalog: CatalogService) {}

  @Patch('order')
  @Audit('admin_province_reorder', 'admin', 'provinces')
  reorder(@Body() dto: ReorderProvincesDto) {
    return this.catalog.setProvinceOrder(dto.provinceIds.map(BigInt));
  }
}
