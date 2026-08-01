import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { PartnerPropertiesService } from './properties.service';
import { OwnershipService } from '../ownership.service';
import {
  CreatePropertyDto,
  UpdatePropertyDto,
  RoomDto,
  UpdateRoomDto,
} from './properties.dto';
import { Actor, Audit, CurrentPartner, type AuthedPartner } from '../../common/decorators';
import { ACTOR } from '../../common/actors';

@Controller('partner/properties')
@Actor(ACTOR.PARTNER)
export class PartnerPropertiesController {
  constructor(
    private readonly properties: PartnerPropertiesService,
    private readonly own: OwnershipService,
  ) {}

  @Get()
  list(@CurrentPartner() partner: AuthedPartner) {
    return this.properties.list(partner.id);
  }

  @Get('provinces')
  provinces() {
    return this.properties.provinces();
  }

  @Get(':id')
  findOne(@CurrentPartner() partner: AuthedPartner, @Param('id') id: string) {
    return this.properties.findOne(partner.id, BigInt(id));
  }

  /** A second property may only be added once the first one was approved. */
  @Post()
  @Audit('partner_property_create')
  create(@CurrentPartner() partner: AuthedPartner, @Body() dto: CreatePropertyDto) {
    this.own.assertVerified(partner);
    return this.properties.create(partner.id, dto);
  }

  @Patch(':id')
  @Audit('partner_property_update', 'properties:id')
  update(
    @CurrentPartner() partner: AuthedPartner,
    @Param('id') id: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.properties.update(partner.id, BigInt(id), dto);
  }

  // ── rooms ─────────────────────────────────────────────────────────────────

  @Post(':id/rooms')
  @Audit('partner_room_create', 'properties:id')
  createRoom(
    @CurrentPartner() partner: AuthedPartner,
    @Param('id') id: string,
    @Body() dto: RoomDto,
  ) {
    this.own.assertVerified(partner);
    return this.properties.createRoom(partner.id, BigInt(id), dto);
  }

  @Patch('rooms/:roomId')
  @Audit('partner_room_update', 'rooms:roomId')
  updateRoom(
    @CurrentPartner() partner: AuthedPartner,
    @Param('roomId') roomId: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.properties.updateRoom(partner.id, BigInt(roomId), dto);
  }

  @Delete('rooms/:roomId')
  @Audit('partner_room_delete', 'rooms:roomId')
  removeRoom(@CurrentPartner() partner: AuthedPartner, @Param('roomId') roomId: string) {
    return this.properties.removeRoom(partner.id, BigInt(roomId));
  }
}
