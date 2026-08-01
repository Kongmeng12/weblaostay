import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PARTNER_STATUS } from '../common/money';
import type { AuthedPartner } from '../common/decorators';

/**
 * Tenant isolation for the partner API.
 *
 * Every partner route that takes an id — a property, a room, a booking — must
 * prove that id belongs to the caller before touching it. A missing check here
 * is not a small bug: it hands one property's bookings, guests and prices to a
 * competitor. The methods deliberately throw NotFound rather than Forbidden for
 * rows that exist but belong to someone else, so the API cannot be used to
 * enumerate other partners' ids.
 */
@Injectable()
export class OwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  /** Refuses partners whose application has not been approved yet. */
  assertVerified(partner: AuthedPartner): void {
    if (partner.status !== PARTNER_STATUS.VERIFIED) {
      throw new ForbiddenException(
        'ໃບສະໝັກຍັງລໍຖ້າການອະນຸມັດ · Your application is still under review',
      );
    }
  }

  async assertOwnsProperty(partnerId: bigint, propertyId: bigint): Promise<void> {
    const property = await this.prisma.properties.findFirst({
      where: { id: propertyId, partner_id: partnerId },
      select: { id: true },
    });
    if (!property) {
      throw new NotFoundException(`ບໍ່ພົບທີ່ພັກ #${propertyId} · Property not found`);
    }
  }

  /** Returns the room's property id, so callers do not have to re-read it. */
  async assertOwnsRoom(partnerId: bigint, roomId: bigint): Promise<bigint> {
    const room = await this.prisma.rooms.findFirst({
      where: { id: roomId, properties: { partner_id: partnerId } },
      select: { id: true, property_id: true },
    });
    if (!room) throw new NotFoundException(`ບໍ່ພົບຫ້ອງ #${roomId} · Room not found`);
    return room.property_id;
  }

  async assertOwnsBooking(partnerId: bigint, bookingId: bigint): Promise<void> {
    const booking = await this.prisma.bookings.findFirst({
      where: { id: bookingId, properties: { partner_id: partnerId } },
      select: { id: true },
    });
    if (!booking) {
      throw new NotFoundException(`ບໍ່ພົບການຈອງ #${bookingId} · Booking not found`);
    }
  }

  /** Every property id this partner owns — the scope for their list queries. */
  async propertyIds(partnerId: bigint): Promise<bigint[]> {
    const rows = await this.prisma.properties.findMany({
      where: { partner_id: partnerId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
