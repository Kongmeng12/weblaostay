import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { booking_status, payout_status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../common/settings.service';
import { LedgerService } from '../booking/ledger.service';
import { formatKip, kipOf } from '../common/money';
import { NotificationsService } from '../notifications/notifications.service';
import { addDaysUtc, startOfWeekUtc, todayUtc, utcMidnight } from '../common/dates';

/**
 * Weekly payouts, and the reconciliation that makes them defensible.
 *
 * v1 wrote a single payout row per partner per week with a summed figure and
 * nothing to check it against. v2 writes `payout_items` — one row per booking —
 * so a partner asking "which stays is this transfer for?" gets an answer, and
 * `gross = commission + net` is checked by the database at both levels.
 */
@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(status?: payout_status) {
    const rows = await this.prisma.payouts.findMany({
      where: status ? { status } : {},
      // 'pending' sorts after 'paid' alphabetically, so descending puts the
      // rows that still need a transfer at the top where they belong.
      orderBy: [{ status: 'desc' }, { period_start: 'desc' }],
      include: {
        partners: {
          select: {
            partner_id: true,
            business_name: true,
            users: { include: { user_profiles: { select: { full_name: true } } } },
          },
        },
        partner_bank_accounts: { select: { bank_name: true, account_number: true } },
        _count: { select: { payout_items: true } },
      },
    });

    const pending = rows.filter((p) => p.status === payout_status.pending);

    return {
      items: rows.map((p) => ({
        id: p.payout_id.toString(),
        partnerId: p.partners.partner_id.toString(),
        partnerName: p.partners.business_name,
        ownerName: p.partners.users.user_profiles?.full_name ?? null,
        bankName: p.partner_bank_accounts?.bank_name ?? null,
        bankAccount: p.partner_bank_accounts
          ? `***${p.partner_bank_accounts.account_number.slice(-4)}`
          : null,
        periodStart: p.period_start,
        periodEnd: p.period_end,
        bookings: p._count.payout_items,
        gross: kipOf(p.gross_amount),
        commission: kipOf(p.commission_amount),
        net: kipOf(p.net_amount),
        status: p.status,
        paidAt: p.paid_at,
      })),
      pendingCount: pending.length,
      pendingTotal: kipOf(pending.reduce((sum, p) => sum + p.net_amount, 0n)),
    };
  }

  /**
   * Builds payout rows for a completed period.
   *
   * Groups every `completed` booking whose stay ended in the period by partner,
   * writes one payout plus one `payout_item` per booking, and skips partners
   * that already have a row for that period — so pressing the button twice
   * cannot pay anyone twice.
   *
   * A booking is attributed by **check-out**: the partner has earned the money
   * once the guest has left.
   */
  async generate(periodStartInput?: string) {
    const { payout_period_days } = await this.settings.get();

    const anchor = periodStartInput
      ? utcMidnight(periodStartInput)
      : addDaysUtc(todayUtc(), -payout_period_days);
    if (Number.isNaN(anchor.getTime())) {
      throw new BadRequestException('periodStart ບໍ່ຖືກຕ້ອງ · Invalid periodStart date');
    }

    const start = startOfWeekUtc(anchor);
    const end = addDaysUtc(start, payout_period_days - 1);
    const endExclusive = addDaysUtc(end, 1);

    return this.prisma.$transaction(async (tx) => {
      const bookings = await tx.bookings.findMany({
        where: {
          status: booking_status.completed,
          deleted_at: null,
          check_out: { gte: start, lt: endExclusive },
        },
        select: {
          booking_id: true,
          total_amount: true,
          commission_amount: true,
          payout_amount: true,
          properties: { select: { partner_id: true } },
        },
      });

      if (!bookings.length) {
        return { periodStart: start, periodEnd: end, created: 0, skipped: 0, totalNet: 0 };
      }

      // Accumulate per partner, keeping each booking so the items can be
      // written alongside the total they add up to.
      //
      // Only two figures are summed. Net is derived from them, here and on
      // every item, because `payouts_net_balances` demands
      // gross = commission + net and a third independent sum is a third chance
      // to disagree by a kip.
      const perPartner = new Map<
        string,
        { gross: bigint; commission: bigint; items: typeof bookings }
      >();

      for (const b of bookings) {
        const key = b.properties.partner_id.toString();
        const acc = perPartner.get(key) ?? { gross: 0n, commission: 0n, items: [] };
        acc.gross += b.total_amount;
        acc.commission += b.commission_amount;
        acc.items.push(b);
        perPartner.set(key, acc);
      }

      const existing = await tx.payouts.findMany({
        where: { period_start: start, period_end: end },
        select: { partner_id: true },
      });
      const already = new Set(existing.map((e) => e.partner_id.toString()));

      let created = 0;
      let skipped = 0;
      let totalNet = 0n;

      for (const [partnerIdStr, acc] of perPartner) {
        if (already.has(partnerIdStr)) {
          skipped++;
          continue;
        }
        const partnerId = BigInt(partnerIdStr);
        const net = acc.gross - acc.commission;

        const bankAccount = await tx.partner_bank_accounts.findFirst({
          where: { partner_id: partnerId, status: 'active', is_default: true },
          select: { bank_account_id: true },
        });

        const payout = await tx.payouts.create({
          data: {
            partner_id: partnerId,
            bank_account_id: bankAccount?.bank_account_id ?? null,
            period_start: start,
            period_end: end,
            gross_amount: acc.gross,
            commission_amount: acc.commission,
            net_amount: net,
            status: payout_status.pending,
          },
        });

        await tx.payout_items.createMany({
          data: acc.items.map((b) => ({
            payout_id: payout.payout_id,
            booking_id: b.booking_id,
            gross_amount: b.total_amount,
            commission_amount: b.commission_amount,
            net_amount: b.total_amount - b.commission_amount,
          })),
          skipDuplicates: true,
        });

        created++;
        totalNet += net;
      }

      this.logger.log(
        `Payout run for ${start.toISOString().slice(0, 10)}: ${created} created, ${skipped} skipped`,
      );

      return {
        periodStart: start,
        periodEnd: end,
        created,
        skipped,
        totalNet: kipOf(totalNet),
      };
    });
  }

  /** Marks one payout paid. Paying an already-paid row is refused. */
  async pay(payoutId: bigint, adminUserId: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.payouts.findUnique({
        where: { payout_id: payoutId },
        include: {
          partners: { select: { partner_id: true, user_id: true, business_name: true } },
          partner_bank_accounts: { select: { bank_name: true } },
        },
      });

      if (!payout) throw new NotFoundException(`ບໍ່ພົບລາຍການໂອນ #${payoutId} · Payout not found`);
      if (payout.status === payout_status.paid) {
        throw new BadRequestException('ໂອນໄປແລ້ວ · This payout has already been paid');
      }

      const updated = await tx.payouts.update({
        where: { payout_id: payoutId },
        data: { status: payout_status.paid, paid_at: new Date(), confirmed_by: adminUserId },
      });

      // The transfer leaving the platform is a movement of money like any
      // other, so it goes in the ledger.
      await this.ledger.recordPayout(tx, {
        partnerId: payout.partners.partner_id,
        payoutId,
        amount: payout.net_amount,
      });

      await this.notifications.send(tx, {
        userId: payout.partners.user_id,
        templateCode: 'payout_paid',
        vars: {
          amount: formatKip(payout.net_amount),
          bank: payout.partner_bank_accounts?.bank_name ?? 'ບັນຊີທີ່ລົງທະບຽນໄວ້',
        },
        referenceType: 'payout',
        referenceId: payoutId,
      });

      return {
        id: updated.payout_id.toString(),
        status: updated.status,
        net: kipOf(updated.net_amount),
        paidAt: updated.paid_at,
      };
    });
  }

  /** Pays every pending payout in one go — the "ຈ່າຍທັງໝົດ" button. */
  async payAll(adminUserId: bigint) {
    const pending = await this.prisma.payouts.findMany({
      where: { status: payout_status.pending },
      select: { payout_id: true },
    });

    let paid = 0;
    let totalNet = 0n;

    // One transaction per payout rather than one big one: a single failure —
    // a payout someone else just settled — must not roll back the rest.
    for (const p of pending) {
      try {
        const result = await this.pay(p.payout_id, adminUserId);
        paid++;
        totalNet += BigInt(result.net);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Could not pay payout ${p.payout_id}: ${message}`);
      }
    }

    return { paid, totalNet: kipOf(totalNet) };
  }

  /** The bookings behind one payout. */
  async items(payoutId: bigint) {
    const payout = await this.prisma.payouts.findUnique({
      where: { payout_id: payoutId },
      include: {
        payout_items: {
          include: {
            bookings: {
              select: { booking_code: true, check_in: true, check_out: true, source: true },
            },
          },
        },
      },
    });
    if (!payout) throw new NotFoundException(`ບໍ່ພົບລາຍການໂອນ #${payoutId} · Payout not found`);

    return {
      id: payout.payout_id.toString(),
      gross: kipOf(payout.gross_amount),
      commission: kipOf(payout.commission_amount),
      net: kipOf(payout.net_amount),
      items: payout.payout_items.map((i) => ({
        bookingId: i.booking_id.toString(),
        code: i.bookings.booking_code,
        checkIn: i.bookings.check_in,
        checkOut: i.bookings.check_out,
        source: i.bookings.source,
        gross: kipOf(i.gross_amount),
        commission: kipOf(i.commission_amount),
        net: kipOf(i.net_amount),
      })),
    };
  }
}
