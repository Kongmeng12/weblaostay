import { Injectable } from '@nestjs/common';
import { Prisma, ledger_direction, ledger_entry_type } from '@prisma/client';

/**
 * The double-entry record of every movement of money.
 *
 * `ledger_entries` is what makes the finances auditable: a payout figure can be
 * traced back to the charges and commissions it came from, years later, without
 * re-deriving anything from bookings whose rows may since have changed.
 *
 * Entries are written inside the same transaction as the thing they describe.
 * A payment that lands without its ledger rows, or ledger rows without the
 * payment, would both be worse than either failing outright.
 */
@Injectable()
export class LedgerService {
  /**
   * `balance_after` is filled from the running total for that partner.
   *
   * It is a convenience for reading a statement, not the source of truth —
   * under concurrent writes two entries can compute the same balance. When the
   * two ever disagree, `SUM(amount)` wins. The alternative, a per-partner
   * advisory lock on every money movement, costs more than the column is worth.
   */
  async record(
    tx: Prisma.TransactionClient,
    entry: {
      entryType: ledger_entry_type;
      direction: ledger_direction;
      amount: bigint;
      bookingId?: bigint | null;
      partnerId?: bigint | null;
      referenceType?: string;
      referenceId?: bigint;
      note?: string;
      at?: Date;
    },
  ): Promise<void> {
    if (entry.amount === 0n) return;

    let balanceAfter: bigint | null = null;
    if (entry.partnerId) {
      const [{ balance }] = await tx.$queryRaw<{ balance: bigint }[]>`
        SELECT COALESCE(SUM(
                 CASE WHEN direction = 'credit' THEN amount ELSE -amount END
               ), 0)::bigint AS balance
        FROM ledger_entries
        WHERE partner_id = ${entry.partnerId}
      `;
      const delta = entry.direction === ledger_direction.credit ? entry.amount : -entry.amount;
      balanceAfter = BigInt(balance) + delta;
    }

    await tx.ledger_entries.create({
      data: {
        entry_type: entry.entryType,
        direction: entry.direction,
        amount: entry.amount,
        booking_id: entry.bookingId ?? null,
        partner_id: entry.partnerId ?? null,
        reference_type: entry.referenceType ?? null,
        reference_id: entry.referenceId ?? null,
        balance_after: balanceAfter,
        note: entry.note ?? null,
        ...(entry.at ? { created_at: entry.at } : {}),
      },
    });
  }

  /**
   * The two entries a settled payment always produces: the guest's money in,
   * and the platform's cut back out.
   */
  async recordCharge(
    tx: Prisma.TransactionClient,
    args: {
      bookingId: bigint;
      partnerId: bigint;
      paymentId: bigint;
      amount: bigint;
      commission: bigint;
      at?: Date;
    },
  ): Promise<void> {
    await this.record(tx, {
      entryType: ledger_entry_type.charge,
      direction: ledger_direction.credit,
      amount: args.amount,
      bookingId: args.bookingId,
      partnerId: args.partnerId,
      referenceType: 'payment',
      referenceId: args.paymentId,
      note: 'ຮັບຊຳລະຈາກແຂກ',
      at: args.at,
    });

    await this.record(tx, {
      entryType: ledger_entry_type.commission,
      direction: ledger_direction.debit,
      amount: args.commission,
      bookingId: args.bookingId,
      partnerId: args.partnerId,
      referenceType: 'booking',
      referenceId: args.bookingId,
      note: 'ຄ່າຄອມມິຊຊັນແພລດຟອມ',
      at: args.at,
    });
  }

  async recordRefund(
    tx: Prisma.TransactionClient,
    args: { bookingId: bigint; partnerId: bigint; refundId: bigint; amount: bigint },
  ): Promise<void> {
    await this.record(tx, {
      entryType: ledger_entry_type.refund,
      direction: ledger_direction.debit,
      amount: args.amount,
      bookingId: args.bookingId,
      partnerId: args.partnerId,
      referenceType: 'refund',
      referenceId: args.refundId,
      note: 'ຄືນເງິນໃຫ້ແຂກ',
    });
  }

  async recordPayout(
    tx: Prisma.TransactionClient,
    args: { partnerId: bigint; payoutId: bigint; amount: bigint },
  ): Promise<void> {
    await this.record(tx, {
      entryType: ledger_entry_type.payout,
      direction: ledger_direction.debit,
      amount: args.amount,
      partnerId: args.partnerId,
      referenceType: 'payout',
      referenceId: args.payoutId,
      note: 'ໂອນເງິນໃຫ້ partner',
    });
  }

  /** What a partner is owed, straight from the entries. */
  async partnerBalance(tx: Prisma.TransactionClient, partnerId: bigint): Promise<bigint> {
    const [{ balance }] = await tx.$queryRaw<{ balance: bigint }[]>`
      SELECT COALESCE(SUM(
               CASE WHEN direction = 'credit' THEN amount ELSE -amount END
             ), 0)::bigint AS balance
      FROM ledger_entries
      WHERE partner_id = ${partnerId}
    `;
    return BigInt(balance);
  }
}
