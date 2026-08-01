import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AVAILABILITY_STATUS,
  PARTNER_STATUS,
  promoDiscount,
  percentOf,
} from './money';
import { addDaysUtc, isoDayUtc, todayUtc } from './dates';

/**
 * One price for a booking, however it was made.
 *
 * The customer app and the partner's walk-in form both create bookings, and a
 * walk-in priced by a different rule than an in-app stay would quietly break
 * the payout maths. Both therefore go through `quoteStay` and neither computes
 * money of its own.
 *
 * Everything is whole kip. `total = subtotal + fee - discount`, exactly — that
 * identity is what `bookings.subtotal/fee/discount/total` promises every report
 * built on top of it.
 */

/** A calendar night and what it costs. */
export interface NightPrice {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  priceKip: number;
}

export interface StayQuote {
  nights: number;
  perNight: NightPrice[];
  subtotal: number;
  fee: number;
  discount: number;
  total: number;
  promoId: bigint | null;
  promoCode: string | null;
}

export interface QuoteInput {
  roomId: bigint;
  checkIn: Date;
  checkOut: Date;
  guests: number;
  promoCode?: string;
  /** % service fee added on top of the room subtotal. */
  serviceFeeRate: number;
  /** Walk-ins are entered by the partner at the desk — no promo, no service fee. */
  walkIn?: boolean;
}

/**
 * Reads the room, its calendar and the promo, and returns what the stay costs.
 * Does **not** write anything and does **not** lock — call it inside the same
 * transaction as `holdNights` when you are about to create a booking.
 */
export async function quoteStay(
  tx: Prisma.TransactionClient,
  input: QuoteInput,
): Promise<StayQuote> {
  const { checkIn, checkOut } = assertStayDates(input.checkIn, input.checkOut);

  const room = await tx.rooms.findUnique({
    where: { id: input.roomId },
    include: { properties: { select: { id: true, partner_id: true, partners: { select: { status: true } } } } },
  });

  if (!room) throw new NotFoundException(`ບໍ່ພົບຫ້ອງ #${input.roomId} · Room not found`);
  if (room.is_active === false) {
    throw new BadRequestException('ຫ້ອງນີ້ປິດຂາຍຢູ່ · This room is not currently bookable');
  }
  if (room.properties.partners.status !== PARTNER_STATUS.VERIFIED) {
    throw new BadRequestException(
      'ທີ່ພັກນີ້ຍັງບໍ່ຜ່ານການອະນຸມັດ · This property is not approved for bookings yet',
    );
  }
  if (input.guests < 1 || input.guests > room.capacity) {
    throw new BadRequestException(
      `ຫ້ອງນີ້ຮັບໄດ້ 1–${room.capacity} ຄົນ · This room takes 1–${room.capacity} guests`,
    );
  }

  // The calendar overrides the room's base price per night; nights with no row
  // simply cost the base price.
  const calendar = await tx.room_availability.findMany({
    where: { room_id: input.roomId, date: { gte: checkIn, lt: checkOut } },
  });
  const byDay = new Map(calendar.map((c) => [isoDayUtc(c.date), c]));

  const perNight: NightPrice[] = [];
  for (let d = new Date(checkIn); d < checkOut; d = addDaysUtc(d, 1)) {
    const key = isoDayUtc(d);
    const row = byDay.get(key);
    perNight.push({ date: key, priceKip: row?.price ?? room.base_price });
  }

  const subtotal = perNight.reduce((sum, n) => sum + n.priceKip, 0);

  // A walk-in guest pays the room rate at the desk: no platform service fee and
  // no app promo. Its lower commission (2.5%) is applied later, at payout.
  const fee = input.walkIn ? 0 : percentOf(subtotal, input.serviceFeeRate);

  let discount = 0;
  let promoId: bigint | null = null;
  let promoCode: string | null = null;

  if (input.promoCode && !input.walkIn) {
    const promo = await findUsablePromo(tx, input.promoCode);
    discount = promoDiscount(promo.type, promo.value, subtotal);
    promoId = promo.id;
    promoCode = promo.code;
  }

  return {
    nights: perNight.length,
    perNight,
    subtotal,
    fee,
    discount,
    // Derived by arithmetic on the three parts, never rounded again, so the
    // identity subtotal + fee - discount = total always holds.
    total: subtotal + fee - discount,
    promoId,
    promoCode,
  };
}

/** Looks up a promo code and refuses it if it cannot be used today. */
export async function findUsablePromo(tx: Prisma.TransactionClient, code: string) {
  const promo = await tx.promos.findUnique({ where: { code: code.trim().toUpperCase() } });

  if (!promo) throw new NotFoundException(`ບໍ່ພົບໂຄ້ດ "${code}" · Promo code not found`);
  if (promo.is_active === false) {
    throw new BadRequestException('ໂຄ້ດນີ້ຖືກປິດແລ້ວ · This promo code is no longer active');
  }
  // expires_at is a date column: the code is good for the whole of that day.
  if (promo.expires_at < todayUtc()) {
    throw new BadRequestException('ໂຄ້ດໝົດອາຍຸແລ້ວ · This promo code has expired');
  }

  return promo;
}

/**
 * Claims every night of the stay in `room_availability`.
 *
 * `qty` copies of the room exist, so a night is only sold out when the number
 * of live bookings covering it reaches `qty`. The availability row is the
 * coarse signal (`closed` means the partner took it off sale entirely); the
 * booking count is the exact one.
 *
 * The `SELECT … FOR UPDATE` is the whole point: two guests checking out at the
 * same instant would otherwise both read "one left" and both book it.
 */
export async function holdNights(
  tx: Prisma.TransactionClient,
  roomId: bigint,
  checkIn: Date,
  checkOut: Date,
  qty: number,
  nightPrices: NightPrice[],
): Promise<void> {
  // Lock the calendar rows that exist and read their status in the same round
  // trip — every query in here is a network hop to Neon, and the transaction
  // holds locks for as long as it runs. Nights with no row yet cannot be
  // double-booked by this query, but the booking-count check below still sees
  // any competing booking once its transaction commits.
  const locked = await tx.$queryRaw<{ day: string; status: string }[]>`
    SELECT to_char(date, 'YYYY-MM-DD') AS day, status
    FROM room_availability
    WHERE room_id = ${roomId} AND date >= ${checkIn} AND date < ${checkOut}
    FOR UPDATE
  `;

  const closed = locked.filter((row) => row.status === AVAILABILITY_STATUS.CLOSED);
  if (closed.length) {
    throw new ConflictException(
      `ວັນທີ ${closed.map((c) => c.day).join(', ')} ບໍ່ເປີດຂາຍ · ` +
        'Those dates are closed for booking',
    );
  }

  // How many live bookings already cover each night of the requested range.
  const overlapping = await tx.bookings.findMany({
    where: {
      room_id: roomId,
      status: { not: 'cancelled' },
      check_in: { lt: checkOut },
      check_out: { gt: checkIn },
    },
    select: { check_in: true, check_out: true },
  });

  const usedPerNight = new Map<string, number>();
  for (const b of overlapping) {
    for (let d = new Date(b.check_in); d < b.check_out; d = addDaysUtc(d, 1)) {
      const key = isoDayUtc(d);
      usedPerNight.set(key, (usedPerNight.get(key) ?? 0) + 1);
    }
  }

  const full = nightPrices.filter((n) => (usedPerNight.get(n.date) ?? 0) >= qty);
  if (full.length) {
    throw new ConflictException(
      `ຫ້ອງເຕັມໃນວັນທີ ${full.map((f) => f.date).join(', ')} · ` +
        'The room is fully booked on those dates',
    );
  }

  // Mark the nights booked. `qty > 1` rooms stay `available` until the last
  // copy goes, so the calendar keeps telling the truth.
  //
  // One statement rather than a loop of upserts: a 14-night stay would
  // otherwise be fourteen round trips inside an open transaction, which is both
  // slow and a long time to hold row locks.
  const dates = nightPrices.map((n) => n.date);
  const prices = nightPrices.map((n) => n.priceKip);
  const statuses = nightPrices.map((n) =>
    (usedPerNight.get(n.date) ?? 0) + 1 >= qty
      ? AVAILABILITY_STATUS.BOOKED
      : AVAILABILITY_STATUS.AVAILABLE,
  );

  await tx.$executeRaw`
    INSERT INTO room_availability (room_id, date, price, status)
    SELECT ${roomId}::bigint, t.d::date, t.p, t.s
    FROM unnest(${dates}::date[], ${prices}::int[], ${statuses}::varchar[]) AS t(d, p, s)
    ON CONFLICT (room_id, date) DO UPDATE SET status = EXCLUDED.status
  `;
}

/**
 * Validates the two date-only inputs and normalises them to UTC midnight.
 *
 * Prisma writes a `date` column from the *UTC* day of a JS Date, so a value
 * built from local midnight lands a day early east of Greenwich. Everything
 * downstream assumes these two are already UTC midnight.
 */
export function assertStayDates(checkInInput: Date | string, checkOutInput: Date | string) {
  const checkIn = utcMidnight(checkInInput);
  const checkOut = utcMidnight(checkOutInput);

  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
    throw new BadRequestException('ວັນທີບໍ່ຖືກຕ້ອງ · Invalid check-in or check-out date');
  }
  if (checkOut <= checkIn) {
    throw new BadRequestException(
      'ວັນອອກຕ້ອງຫຼັງວັນເຂົ້າ · Check-out must be after check-in',
    );
  }
  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
  if (nights > 60) {
    throw new BadRequestException('ຈອງໄດ້ສູງສຸດ 60 ຄືນ · A stay may not exceed 60 nights');
  }

  return { checkIn, checkOut, nights };
}

/** `2026-08-01` or a Date, as UTC midnight of that calendar day. */
export function utcMidnight(value: Date | string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return d;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
