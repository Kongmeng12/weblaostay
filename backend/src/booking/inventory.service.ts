import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isoDayUtc } from '../common/dates';

/**
 * Inventory: the code that makes overbooking impossible.
 *
 * Three numbers per room type per night — `total_count`, `held_count`,
 * `booked_count` — with `available_count` generated from them and a database
 * CHECK refusing `held + booked > total`. The rules below are the application's
 * half of that bargain; the CHECK is the half that catches anything this misses.
 *
 * **Never write `available_count`.** Prisma introspects it as an ordinary
 * nullable column, so nothing stops you at compile time, but Postgres rejects a
 * write to a generated column at runtime.
 */
@Injectable()
export class InventoryService {
  /**
   * Takes a hold on every night of a stay.
   *
   * Lock-then-check-then-write in one statement. Two guests taking the last
   * room at the same instant would otherwise both read "one left" and both get
   * it, so the CTE locks the nights with `FOR UPDATE`; the second transaction
   * waits, and when it wakes Postgres re-evaluates the CTE's own qualifiers
   * against the row the first one committed. The availability test therefore
   * sees the truth rather than the snapshot it started with.
   *
   * Doing it as one round-trip rather than a SELECT followed by an UPDATE
   * matters more than it looks: every extra statement is another Neon
   * round-trip spent holding a lock that every other booking for that room is
   * queued behind. `ORDER BY date` keeps two overlapping stays queueing instead
   * of deadlocking.
   *
   * A short count means some night failed the test. Which night, and why, costs
   * a second query — but only on the path that is about to roll back anyway.
   */
  async hold(
    tx: Prisma.TransactionClient,
    roomTypeId: bigint,
    checkIn: Date,
    checkOut: Date,
    quantity: number,
  ): Promise<void> {
    const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);

    const held = await tx.$executeRaw`
      WITH bookable AS (
        SELECT inventory_id
        FROM room_inventory
        WHERE room_type_id = ${roomTypeId}
          AND date >= ${checkIn}::date AND date < ${checkOut}::date
          AND status = 'open'
          AND total_count - held_count - booked_count >= ${quantity}
        ORDER BY date
        FOR UPDATE
      )
      UPDATE room_inventory ri
      SET held_count = ri.held_count + ${quantity}
      FROM bookable b
      WHERE ri.inventory_id = b.inventory_id
    `;

    if (held !== nights) await this.explainUnavailable(tx, roomTypeId, checkIn, checkOut, quantity);
  }

  /**
   * Turns a failed hold into a message a guest can act on. Called only after
   * the hold came up short, on a transaction that is about to be rolled back.
   */
  private async explainUnavailable(
    tx: Prisma.TransactionClient,
    roomTypeId: bigint,
    checkIn: Date,
    checkOut: Date,
    quantity: number,
  ): Promise<never> {
    const rows = await tx.$queryRaw<{ date: Date; status: string; available_count: number }[]>`
      SELECT date, status::text, available_count
      FROM room_inventory
      WHERE room_type_id = ${roomTypeId}
        AND date >= ${checkIn}::date AND date < ${checkOut}::date
      ORDER BY date
    `;

    const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);

    // A night with no row was never put on sale. Treating a missing row as
    // "available" is how a partner ends up with a guest they never opened for.
    if (rows.length !== nights) {
      throw new ConflictException(
        'ບາງຄືນຍັງບໍ່ໄດ້ເປີດຂາຍ · Some nights in that range are not on sale',
      );
    }

    const closed = rows.filter((r) => r.status !== 'open');
    if (closed.length) {
      throw new ConflictException(
        `ວັນທີ ${closed.map((c) => isoDayUtc(c.date)).join(', ')} ບໍ່ເປີດຂາຍ · ` +
          'Those dates are closed for booking',
      );
    }

    const full = rows.filter((r) => r.available_count < quantity);
    if (full.length) {
      throw new ConflictException(
        `ຫ້ອງເຕັມໃນວັນທີ ${full.map((f) => isoDayUtc(f.date)).join(', ')} · ` +
          'The room is fully booked on those dates',
      );
    }

    // The rows read clear now, so the night was taken between the update and
    // this read. Still a conflict, and retrying is the right advice.
    throw new ConflictException(
      'ຫ້ອງຫາກໍຖືກຈອງໄປ ກະລຸນາລອງໃໝ່ · That room was just taken — please try again',
    );
  }

  /** Releases a hold — the guest walked away, or the hold timed out. */
  async releaseHold(
    tx: Prisma.TransactionClient,
    roomTypeId: bigint,
    checkIn: Date,
    checkOut: Date,
    quantity: number,
  ): Promise<void> {
    // GREATEST keeps the counter from going negative if a release ever runs
    // twice — the CHECK would not catch that, and a negative held_count would
    // quietly oversell the room.
    await tx.$executeRaw`
      UPDATE room_inventory
      SET held_count = GREATEST(held_count - ${quantity}, 0)
      WHERE room_type_id = ${roomTypeId}
        AND date >= ${checkIn}::date AND date < ${checkOut}::date
    `;
  }

  /**
   * Payment landed: the hold becomes a booking. One statement so the two
   * counters can never be observed apart.
   */
  async confirmHold(
    tx: Prisma.TransactionClient,
    roomTypeId: bigint,
    checkIn: Date,
    checkOut: Date,
    quantity: number,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE room_inventory
      SET held_count   = GREATEST(held_count - ${quantity}, 0),
          booked_count = booked_count + ${quantity}
      WHERE room_type_id = ${roomTypeId}
        AND date >= ${checkIn}::date AND date < ${checkOut}::date
    `;
  }

  /** A confirmed booking was cancelled: give the nights back. */
  async releaseBooked(
    tx: Prisma.TransactionClient,
    roomTypeId: bigint,
    checkIn: Date,
    checkOut: Date,
    quantity: number,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE room_inventory
      SET booked_count = GREATEST(booked_count - ${quantity}, 0)
      WHERE room_type_id = ${roomTypeId}
        AND date >= ${checkIn}::date AND date < ${checkOut}::date
    `;
  }

  /**
   * A walk-in is already in the room, so it goes straight to `booked` without
   * passing through a hold.
   */
  async bookDirect(
    tx: Prisma.TransactionClient,
    roomTypeId: bigint,
    checkIn: Date,
    checkOut: Date,
    quantity: number,
  ): Promise<void> {
    await this.hold(tx, roomTypeId, checkIn, checkOut, quantity);
    await this.confirmHold(tx, roomTypeId, checkIn, checkOut, quantity);
  }

  /**
   * Opens nights for sale, creating the rows that do not exist yet.
   *
   * `total_count` is the only thing a partner sets; held and booked belong to
   * the booking flow. Lowering `total_count` below what is already sold is
   * refused by the CHECK, which is the correct answer — the guests are already
   * booked.
   */
  async openRange(
    tx: Prisma.TransactionClient,
    roomTypeId: bigint,
    from: Date,
    toExclusive: Date,
    totalCount: number,
    status: 'open' | 'closed',
  ): Promise<number> {
    const affected = await tx.$executeRaw`
      INSERT INTO room_inventory (room_type_id, date, total_count, held_count, booked_count, status)
      SELECT ${roomTypeId}, gs::date, ${totalCount}, 0, 0, ${status}::inventory_status
      FROM generate_series(${from}::date, ${toExclusive}::date - 1, '1 day') AS gs
      ON CONFLICT (room_type_id, date) DO UPDATE
        SET total_count = EXCLUDED.total_count,
            status      = EXCLUDED.status
    `;
    return affected;
  }

  /** Sets prices across a range, leaving inventory alone. */
  async priceRange(
    tx: Prisma.TransactionClient,
    roomTypeId: bigint,
    from: Date,
    toExclusive: Date,
    price: bigint,
    priceType: 'weekday' | 'weekend' | 'seasonal' | 'holiday',
  ): Promise<number> {
    return tx.$executeRaw`
      INSERT INTO room_prices (room_type_id, date, price, price_type)
      SELECT ${roomTypeId}, gs::date, ${price}, ${priceType}::price_type
      FROM generate_series(${from}::date, ${toExclusive}::date - 1, '1 day') AS gs
      ON CONFLICT (room_type_id, date) DO UPDATE
        SET price = EXCLUDED.price, price_type = EXCLUDED.price_type
    `;
  }

  /**
   * The nightly prices for a stay, and their sum.
   *
   * Falls back to `room_types.base_price` for nights the partner never priced,
   * so a property is sellable the moment it has a base price.
   */
  async priceStay(
    tx: Prisma.TransactionClient,
    roomTypeId: bigint,
    checkIn: Date,
    checkOut: Date,
  ): Promise<{ perNight: { date: string; price: bigint }[]; subtotal: bigint }> {
    const rows = await tx.$queryRaw<{ date: Date; price: bigint }[]>`
      WITH nights AS (
        SELECT gs::date AS d
        FROM generate_series(${checkIn}::date, ${checkOut}::date - 1, '1 day') AS gs
      )
      SELECT n.d AS date, COALESCE(rp.price, rt.base_price) AS price
      FROM nights n
      CROSS JOIN room_types rt
      LEFT JOIN room_prices rp ON rp.room_type_id = rt.room_type_id AND rp.date = n.d
      WHERE rt.room_type_id = ${roomTypeId}
      ORDER BY n.d
    `;

    if (!rows.length) {
      throw new NotFoundException(`ບໍ່ພົບປະເພດຫ້ອງ #${roomTypeId} · Room type not found`);
    }

    const perNight = rows.map((r) => ({ date: isoDayUtc(r.date), price: BigInt(r.price) }));
    const subtotal = perNight.reduce((sum, n) => sum + n.price, 0n);
    return { perNight, subtotal };
  }

  /** Guards the shape of a requested stay before any money is calculated. */
  assertStay(checkIn: Date, checkOut: Date, maxNights: number): number {
    if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
      throw new BadRequestException('ວັນທີບໍ່ຖືກຕ້ອງ · Invalid check-in or check-out date');
    }
    if (checkOut <= checkIn) {
      throw new BadRequestException('ວັນອອກຕ້ອງຫຼັງວັນເຂົ້າ · Check-out must be after check-in');
    }
    const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
    if (nights > maxNights) {
      throw new BadRequestException(
        `ຈອງໄດ້ສູງສຸດ ${maxNights} ຄືນ · A stay may not exceed ${maxNights} nights`,
      );
    }
    return nights;
  }
}
