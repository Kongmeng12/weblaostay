import { BadRequestException, Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../ownership.service';
import { Actor, Audit, CurrentPartner, type AuthedPartner } from '../../common/decorators';
import { ACTOR } from '../../common/actors';
import { AVAILABILITY_STATUS } from '../../common/money';
import { addDaysUtc, isoDayUtc } from '../../common/dates';
import { utcMidnight } from '../../common/booking-pricing';

class RangeQueryDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}

class SetAvailabilityDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;

  /** Whole kip. Omit to change only the status. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'ລາຄາຕ້ອງເປັນຈຳນວນເຕັມກີບ · Price must be whole kip' })
  @Min(1000)
  @Max(500_000_000)
  price?: number;

  /** `booked` is set by the booking flow, never by hand. */
  @IsOptional()
  @IsIn([AVAILABILITY_STATUS.AVAILABLE, AVAILABILITY_STATUS.CLOSED])
  status?: string;
}

/**
 * The pricing calendar.
 *
 * `room_availability` holds one row per room per night. Nights with no row are
 * simply on sale at the room's base price — the calendar is an override sheet,
 * not a requirement, so a partner who never opens this screen still sells.
 */
@Controller('partner/rooms/:roomId/availability')
@Actor(ACTOR.PARTNER)
export class PartnerAvailabilityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly own: OwnershipService,
  ) {}

  @Get()
  async list(
    @CurrentPartner() partner: AuthedPartner,
    @Param('roomId') roomId: string,
    @Query() query: RangeQueryDto,
  ) {
    const id = BigInt(roomId);
    await this.own.assertOwnsRoom(partner.id, id);

    const { from, to } = this.parseRange(query.from, query.to);
    const room = await this.prisma.rooms.findUniqueOrThrow({
      where: { id },
      select: { base_price: true, qty: true },
    });

    const rows = await this.prisma.room_availability.findMany({
      where: { room_id: id, date: { gte: from, lt: to } },
    });
    const byDay = new Map(rows.map((r) => [isoDayUtc(r.date), r]));

    // Fill the gaps so the client gets one entry per night and never has to
    // guess what an absent row means.
    const days: { date: string; price: number; status: string; overridden: boolean }[] = [];
    for (let d = new Date(from); d < to; d = addDaysUtc(d, 1)) {
      const key = isoDayUtc(d);
      const row = byDay.get(key);
      days.push({
        date: key,
        price: row?.price ?? room.base_price,
        status: row?.status ?? AVAILABILITY_STATUS.AVAILABLE,
        overridden: Boolean(row),
      });
    }

    return { roomId: id, basePrice: room.base_price, qty: room.qty, days };
  }

  /**
   * Set price and/or status across a date range.
   *
   * Nights already sold are left alone: re-pricing a booked night would change
   * what a guest agreed to pay, and re-opening one would sell it twice.
   */
  @Patch()
  @Audit('partner_availability_update', 'rooms:roomId')
  async set(
    @CurrentPartner() partner: AuthedPartner,
    @Param('roomId') roomId: string,
    @Body() dto: SetAvailabilityDto,
  ) {
    const id = BigInt(roomId);
    this.own.assertVerified(partner);
    await this.own.assertOwnsRoom(partner.id, id);

    if (dto.price === undefined && dto.status === undefined) {
      throw new BadRequestException('ຕ້ອງລະບຸ price ຫຼື status · Provide price or status');
    }

    const { from, to } = this.parseRange(dto.from, dto.to);
    const room = await this.prisma.rooms.findUniqueOrThrow({
      where: { id },
      select: { base_price: true },
    });

    const booked = await this.prisma.room_availability.findMany({
      where: { room_id: id, date: { gte: from, lt: to }, status: AVAILABILITY_STATUS.BOOKED },
      select: { date: true },
    });
    const bookedDays = new Set(booked.map((b) => isoDayUtc(b.date)));

    let updated = 0;
    for (let d = new Date(from); d < to; d = addDaysUtc(d, 1)) {
      if (bookedDays.has(isoDayUtc(d))) continue;
      const date = new Date(d);

      await this.prisma.room_availability.upsert({
        where: { room_id_date: { room_id: id, date } },
        create: {
          room_id: id,
          date,
          price: dto.price ?? room.base_price,
          status: dto.status ?? AVAILABILITY_STATUS.AVAILABLE,
        },
        update: {
          ...(dto.price !== undefined && { price: dto.price }),
          ...(dto.status !== undefined && { status: dto.status }),
        },
      });
      updated++;
    }

    return { roomId: id, updated, skippedBooked: bookedDays.size };
  }

  /** Both ends are calendar days; `to` is exclusive, like a stay's check-out. */
  private parseRange(fromInput: string, toInput: string) {
    const from = utcMidnight(fromInput);
    const to = utcMidnight(toInput);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      throw new BadRequestException('ຊ່ວງວັນທີບໍ່ຖືກຕ້ອງ · Invalid date range');
    }
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    if (days > 366) {
      throw new BadRequestException('ຊ່ວງສູງສຸດ 366 ວັນ · Range may not exceed 366 days');
    }
    return { from, to };
  }
}
