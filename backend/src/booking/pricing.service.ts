import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, booking_source } from '@prisma/client';
import { InventoryService } from './inventory.service';
import { SettingsService } from '../common/settings.service';
import { kipOf, percentOf } from '../common/money';

/** What a stay costs, broken into the columns `bookings` stores. */
export interface StayQuote {
  roomTypeId: bigint;
  propertyId: bigint;
  partnerId: bigint;
  nights: number;
  quantity: number;
  perNight: { date: string; price: bigint }[];
  subtotalAmount: bigint;
  serviceFee: bigint;
  taxAmount: bigint;
  cleaningFee: bigint;
  discountAmount: bigint;
  totalAmount: bigint;
  commissionRate: number;
  commissionAmount: bigint;
  payoutAmount: bigint;
}

export interface QuoteInput {
  roomTypeId: bigint;
  checkIn: Date;
  checkOut: Date;
  guests: number;
  quantity?: number;
  source?: booking_source;
}

/**
 * One place that prices a stay.
 *
 * The customer app and the partner's walk-in form both create bookings. If they
 * priced differently the payout figures would stop reconciling, and the first
 * symptom would be a partner disputing a transfer. Both therefore call `quote`,
 * and neither computes money of its own.
 *
 * The identity every figure has to preserve is the one the database checks:
 * `subtotal + service_fee + tax + cleaning - discount = total`.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly settings: SettingsService,
    private readonly inventory: InventoryService,
  ) {}

  async quote(tx: Prisma.TransactionClient, input: QuoteInput): Promise<StayQuote> {
    const settings = await this.settings.get();
    const quantity = input.quantity ?? 1;
    const nights = this.inventory.assertStay(
      input.checkIn,
      input.checkOut,
      settings.max_nights_per_booking,
    );

    const roomType = await tx.room_types.findFirst({
      where: { room_type_id: input.roomTypeId, deleted_at: null },
      include: {
        properties: {
          include: { partners: { select: { partner_id: true, status: true, default_commission_rate: true, walkin_commission_rate: true } } },
        },
      },
    });

    if (!roomType) {
      throw new NotFoundException(`ບໍ່ພົບປະເພດຫ້ອງ #${input.roomTypeId} · Room type not found`);
    }
    if (roomType.status !== 'active') {
      throw new BadRequestException('ຫ້ອງນີ້ປິດຂາຍຢູ່ · This room type is not currently bookable');
    }
    if (roomType.properties.partners.status !== 'verified') {
      throw new BadRequestException(
        'ທີ່ພັກນີ້ຍັງບໍ່ຜ່ານການອະນຸມັດ · This property is not approved for bookings yet',
      );
    }
    if (nights < roomType.min_nights) {
      throw new BadRequestException(
        `ຫ້ອງນີ້ຕ້ອງພັກຢ່າງໜ້ອຍ ${roomType.min_nights} ຄືນ · This room requires at least ${roomType.min_nights} nights`,
      );
    }

    // Occupancy is per room; asking for two rooms doubles what they hold.
    const capacity = roomType.max_occupancy * quantity;
    if (input.guests < 1 || input.guests > capacity) {
      throw new BadRequestException(
        `ຮັບໄດ້ 1–${capacity} ຄົນ · This selection takes 1–${capacity} guests`,
      );
    }

    const { perNight, subtotal } = await this.inventory.priceStay(
      tx,
      input.roomTypeId,
      input.checkIn,
      input.checkOut,
    );

    const roomsSubtotal = subtotal * BigInt(quantity);

    // A walk-in guest pays the room rate at the desk: no platform service fee,
    // and the lower commission. Both are decided here, once.
    const isWalkIn = input.source === booking_source.walk_in;
    const serviceFee = isWalkIn ? 0n : percentOf(roomsSubtotal, settings.service_fee_rate);
    const taxAmount = percentOf(roomsSubtotal + serviceFee, settings.tax_rate);
    const cleaningFee = 0n;
    const discountAmount = 0n; // promotions land in round two

    const totalAmount = roomsSubtotal + serviceFee + taxAmount + cleaningFee - discountAmount;

    // Snapshot the rate on the booking so a later change never restates what
    // was already earned.
    const partner = roomType.properties.partners;
    const commissionRate = Number(
      (isWalkIn ? partner.walkin_commission_rate : partner.default_commission_rate).toString(),
    );
    const commissionAmount = percentOf(totalAmount, commissionRate);

    return {
      roomTypeId: roomType.room_type_id,
      propertyId: roomType.property_id,
      partnerId: partner.partner_id,
      nights,
      quantity,
      perNight,
      subtotalAmount: roomsSubtotal,
      serviceFee,
      taxAmount,
      cleaningFee,
      discountAmount,
      totalAmount,
      commissionRate,
      commissionAmount,
      // Derived by subtraction, so gross = commission + net holds exactly.
      payoutAmount: totalAmount - commissionAmount,
    };
  }

  /** The quote as the API returns it — money as numbers, ids as strings. */
  toView(quote: StayQuote) {
    return {
      roomTypeId: quote.roomTypeId.toString(),
      propertyId: quote.propertyId.toString(),
      nights: quote.nights,
      quantity: quote.quantity,
      perNight: quote.perNight.map((n) => ({ date: n.date, price: kipOf(n.price) })),
      subtotal: kipOf(quote.subtotalAmount),
      serviceFee: kipOf(quote.serviceFee),
      tax: kipOf(quote.taxAmount),
      cleaningFee: kipOf(quote.cleaningFee),
      discount: kipOf(quote.discountAmount),
      total: kipOf(quote.totalAmount),
    };
  }
}
