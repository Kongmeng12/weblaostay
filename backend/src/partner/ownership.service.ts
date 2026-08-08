import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { partner_status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthedUser } from '../common/decorators';

/**
 * Tenant isolation for the partner API.
 *
 * Every partner route that takes an id — a property, a room type, a booking —
 * must prove that id belongs to the caller before touching it. A missing check
 * here is not a small bug: it hands one property's bookings, guests and prices
 * to a competitor.
 *
 * These throw NotFound rather than Forbidden for rows that exist but belong to
 * someone else, so the API cannot be used to enumerate other partners' ids.
 */
@Injectable()
export class OwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's partner row, or a clear error saying why they have none. */
  partnerId(user: AuthedUser): bigint {
    if (user.partnerId === null) {
      throw new ForbiddenException('ບັນຊີນີ້ບໍ່ແມ່ນ partner · This account is not a partner');
    }
    return user.partnerId;
  }

  /** Refuses partners whose application has not been approved yet. */
  async assertVerified(partnerId: bigint): Promise<void> {
    const partner = await this.prisma.partners.findUnique({
      where: { partner_id: partnerId },
      select: { status: true },
    });
    if (partner?.status !== partner_status.verified) {
      throw new ForbiddenException(
        'ໃບສະໝັກຍັງລໍຖ້າການອະນຸມັດ · Your application is still under review',
      );
    }
  }

  async assertOwnsProperty(partnerId: bigint, propertyId: bigint): Promise<void> {
    const property = await this.prisma.properties.findFirst({
      where: { property_id: propertyId, partner_id: partnerId, deleted_at: null },
      select: { property_id: true },
    });
    if (!property) {
      throw new NotFoundException(`ບໍ່ພົບທີ່ພັກ #${propertyId} · Property not found`);
    }
  }

  /** Returns the room type's property id, so callers need not re-read it. */
  async assertOwnsRoomType(partnerId: bigint, roomTypeId: bigint): Promise<bigint> {
    const roomType = await this.prisma.room_types.findFirst({
      where: {
        room_type_id: roomTypeId,
        deleted_at: null,
        properties: { partner_id: partnerId, deleted_at: null },
      },
      select: { property_id: true },
    });
    if (!roomType) {
      throw new NotFoundException(`ບໍ່ພົບປະເພດຫ້ອງ #${roomTypeId} · Room type not found`);
    }
    return roomType.property_id;
  }

  async assertOwnsBooking(partnerId: bigint, bookingId: bigint): Promise<void> {
    const booking = await this.prisma.bookings.findFirst({
      where: { booking_id: bookingId, properties: { partner_id: partnerId } },
      select: { booking_id: true },
    });
    if (!booking) {
      throw new NotFoundException(`ບໍ່ພົບການຈອງ #${bookingId} · Booking not found`);
    }
  }

  /** Every property id this partner owns — the scope for their list queries. */
  async propertyIds(partnerId: bigint): Promise<bigint[]> {
    const rows = await this.prisma.properties.findMany({
      where: { partner_id: partnerId, deleted_at: null },
      select: { property_id: true },
    });
    return rows.map((r) => r.property_id);
  }
}
