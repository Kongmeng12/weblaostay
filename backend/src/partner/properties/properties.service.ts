import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../ownership.service';
import type { CreatePropertyDto, UpdatePropertyDto, RoomDto, UpdateRoomDto } from './properties.dto';

/**
 * A partner's own properties and rooms.
 *
 * Reads are scoped by `partner_id` in the query itself rather than filtered
 * afterwards, so a mistake produces an empty list instead of someone else's
 * data.
 */
@Injectable()
export class PartnerPropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly own: OwnershipService,
  ) {}

  async list(partnerId: bigint) {
    const rows = await this.prisma.properties.findMany({
      where: { partner_id: partnerId },
      orderBy: { id: 'asc' },
      include: {
        rooms: { orderBy: { id: 'asc' } },
        _count: { select: { bookings: true, reviews: true } },
      },
    });

    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      province: p.province,
      address: p.address,
      lat: p.lat,
      lng: p.lng,
      rating: p.rating,
      reviewCount: p.review_count,
      amenities: p.amenities,
      photos: p.photos ?? [],
      rooms: p.rooms.map(toRoom),
      bookingCount: p._count.bookings,
    }));
  }

  async findOne(partnerId: bigint, id: bigint) {
    await this.own.assertOwnsProperty(partnerId, id);
    const property = await this.prisma.properties.findUniqueOrThrow({
      where: { id },
      include: { rooms: { orderBy: { id: 'asc' } } },
    });
    return { ...property, photos: property.photos ?? [], rooms: property.rooms.map(toRoom) };
  }

  create(partnerId: bigint, dto: CreatePropertyDto) {
    return this.prisma.properties.create({
      data: {
        partner_id: partnerId,
        name: dto.name,
        type: dto.type,
        province: dto.province,
        address: dto.address,
        ...(dto.lat !== undefined && { lat: dto.lat }),
        ...(dto.lng !== undefined && { lng: dto.lng }),
        // Prisma types jsonb input as InputJsonValue, which a plain
        // Record<string, unknown> does not satisfy structurally.
        ...(dto.amenities !== undefined && {
          amenities: dto.amenities as Prisma.InputJsonValue,
        }),
      },
    });
  }

  async update(partnerId: bigint, id: bigint, dto: UpdatePropertyDto) {
    await this.own.assertOwnsProperty(partnerId, id);
    return this.prisma.properties.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.province !== undefined && { province: dto.province }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.lat !== undefined && { lat: dto.lat }),
        ...(dto.lng !== undefined && { lng: dto.lng }),
        // Prisma types jsonb input as InputJsonValue, which a plain
        // Record<string, unknown> does not satisfy structurally.
        ...(dto.amenities !== undefined && {
          amenities: dto.amenities as Prisma.InputJsonValue,
        }),
      },
    });
  }

  // ── rooms ─────────────────────────────────────────────────────────────────

  async createRoom(partnerId: bigint, propertyId: bigint, dto: RoomDto) {
    await this.own.assertOwnsProperty(partnerId, propertyId);
    const room = await this.prisma.rooms.create({
      data: {
        property_id: propertyId,
        name: dto.name,
        room_no: dto.roomNo ?? null,
        has_ac: dto.hasAc ?? true,
        bed_type: dto.bedType,
        base_price: dto.basePrice,
        capacity: dto.capacity,
        qty: dto.qty,
      },
    });
    return toRoom(room);
  }

  async updateRoom(partnerId: bigint, roomId: bigint, dto: UpdateRoomDto) {
    await this.own.assertOwnsRoom(partnerId, roomId);
    const room = await this.prisma.rooms.update({
      where: { id: roomId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.roomNo !== undefined && { room_no: dto.roomNo }),
        ...(dto.hasAc !== undefined && { has_ac: dto.hasAc }),
        ...(dto.bedType !== undefined && { bed_type: dto.bedType }),
        ...(dto.basePrice !== undefined && { base_price: dto.basePrice }),
        ...(dto.capacity !== undefined && { capacity: dto.capacity }),
        ...(dto.qty !== undefined && { qty: dto.qty }),
        ...(dto.isActive !== undefined && { is_active: dto.isActive }),
      },
    });
    return toRoom(room);
  }

  /**
   * Rooms are never hard-deleted once they carry history — a booking row points
   * at the room and the guest is entitled to see what they booked. Deactivating
   * takes it off sale, which is what "delete" means to the partner.
   */
  async removeRoom(partnerId: bigint, roomId: bigint) {
    await this.own.assertOwnsRoom(partnerId, roomId);

    const bookings = await this.prisma.bookings.count({ where: { room_id: roomId } });
    if (bookings > 0) {
      const room = await this.prisma.rooms.update({
        where: { id: roomId },
        data: { is_active: false },
      });
      return { deleted: false, deactivated: true, room: toRoom(room) };
    }

    await this.prisma.$transaction([
      this.prisma.room_availability.deleteMany({ where: { room_id: roomId } }),
      this.prisma.rooms.delete({ where: { id: roomId } }),
    ]);
    return { deleted: true, deactivated: false, id: roomId.toString() };
  }

  /** Province list for the property form, matching the admin filter options. */
  async provinces() {
    const rows = await this.prisma.properties.groupBy({
      by: ['province'],
      _count: true,
      orderBy: { province: 'asc' },
    });
    return rows.map((r) => r.province);
  }

  /** Guards a photo write: the property must be the caller's. */
  async assertOwnsPropertyOrThrow(partnerId: bigint, propertyId: bigint) {
    await this.own.assertOwnsProperty(partnerId, propertyId);
  }

  async requireRoom(roomId: bigint) {
    const room = await this.prisma.rooms.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException(`ບໍ່ພົບຫ້ອງ #${roomId} · Room not found`);
    if (room.qty < 1) throw new BadRequestException('ຈຳນວນຫ້ອງຕ້ອງຢ່າງໜ້ອຍ 1 · qty must be at least 1');
    return room;
  }
}

function toRoom(r: {
  id: bigint;
  property_id: bigint;
  name: string;
  room_no: string | null;
  has_ac: boolean | null;
  bed_type: string;
  base_price: number;
  capacity: number;
  qty: number;
  is_active: boolean | null;
  photos?: unknown;
}) {
  return {
    id: r.id,
    propertyId: r.property_id,
    name: r.name,
    roomNo: r.room_no,
    hasAc: r.has_ac ?? true,
    bedType: r.bed_type,
    basePrice: r.base_price,
    capacity: r.capacity,
    qty: r.qty,
    isActive: r.is_active ?? true,
    photos: r.photos ?? [],
  };
}
