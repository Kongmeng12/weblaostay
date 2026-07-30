import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../common/settings.service';
import {
  BOOKING_STATUS,
  PAYOUT_STATUS,
  percentOf,
  rateForSource,
} from '../../common/money';
import { addDaysUtc, daysAgoUtc, isoDayUtc, startOfWeekUtc } from '../../common/dates';

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async list(status?: string) {
    const where: Prisma.payoutsWhereInput = {};
    if (status) where.status = status;

    const rows = await this.prisma.payouts.findMany({
      where,
      // 'pending' sorts after 'paid' alphabetically, so descending puts the
      // rows that still need a transfer at the top where they belong.
      orderBy: [{ status: 'desc' }, { period_start: 'desc' }],
      include: {
        partners: {
          select: {
            id: true,
            owner_name: true,
            bank_name: true,
            bank_account: true,
            properties: { select: { name: true }, take: 1 },
          },
        },
      },
    });

    // Booking counts for the "8 bookings" column, in one grouped query.
    const counts = await this.bookingCountsFor(rows);

    const items = rows.map((p) => ({
      id: p.id,
      partnerId: p.partners.id,
      partnerName: p.partners.properties[0]?.name ?? p.partners.owner_name,
      ownerName: p.partners.owner_name,
      bankName: p.partners.bank_name,
      bankAccount: maskAccount(p.partners.bank_account),
      periodStart: p.period_start,
      periodEnd: p.period_end,
      bookings: counts.get(`${p.partner_id}|${isoDayUtc(p.period_start)}`) ?? 0,
      gmv: p.gmv,
      commission: p.commission,
      netAmount: p.net_amount,
      status: p.status,
      paidAt: p.paid_at,
    }));

    const pendingTotal = items
      .filter((i) => i.status === PAYOUT_STATUS.PENDING)
      .reduce((s, i) => s + i.netAmount, 0);

    return { items, pendingTotal, pendingCount: items.filter((i) => i.status === PAYOUT_STATUS.PENDING).length };
  }

  /**
   * Build payout rows for a completed week.
   *
   * Groups every `done` booking in the period by partner, applies the rate that
   * matches each booking's source, and writes one payout per partner. Runs in a
   * transaction and skips partners that already have a row for the period, so
   * pressing the button twice cannot pay anyone twice.
   */
  async generate(periodStartInput?: string) {
    const { commission_rate, walkin_commission_rate } = await this.settings.get();

    const anchor = periodStartInput ? new Date(periodStartInput) : daysAgoUtc(7);
    if (Number.isNaN(anchor.getTime())) {
      throw new BadRequestException('periodStart ບໍ່ຖືກຕ້ອງ · Invalid periodStart date');
    }

    const start = startOfWeekUtc(anchor);
    const end = addDaysUtc(start, 6);

    // Bookings are attributed to the period by check-out date: the partner has
    // earned the money once the guest has left.
    const endExclusive = addDaysUtc(end, 1);

    return this.prisma.$transaction(async (tx) => {
      const bookings = await tx.bookings.findMany({
        where: {
          status: BOOKING_STATUS.DONE,
          check_out: { gte: start, lt: endExclusive },
        },
        select: {
          total: true,
          source: true,
          properties: { select: { partner_id: true } },
        },
      });

      if (!bookings.length) {
        return { periodStart: start, periodEnd: end, created: 0, skipped: 0, payouts: [] };
      }

      // Accumulate per partner, applying the correct rate booking by booking so
      // a mix of app and walk-in stays is commissioned exactly.
      const perPartner = new Map<string, { gmv: number; commission: number }>();
      for (const b of bookings) {
        const key = b.properties.partner_id.toString();
        const rate = rateForSource(b.source, commission_rate, walkin_commission_rate);
        const acc = perPartner.get(key) ?? { gmv: 0, commission: 0 };
        acc.gmv += b.total;
        acc.commission += percentOf(b.total, rate);
        perPartner.set(key, acc);
      }

      const existing = await tx.payouts.findMany({
        where: { period_start: start, period_end: end },
        select: { partner_id: true },
      });
      const already = new Set(existing.map((e) => e.partner_id.toString()));

      const created: Prisma.payoutsCreateManyInput[] = [];
      let skipped = 0;

      for (const [partnerId, acc] of perPartner) {
        if (already.has(partnerId)) {
          skipped++;
          continue;
        }
        created.push({
          partner_id: BigInt(partnerId),
          period_start: start,
          period_end: end,
          gmv: acc.gmv,
          commission: acc.commission,
          // Derived by subtraction so gmv === commission + net, exactly.
          net_amount: acc.gmv - acc.commission,
          status: PAYOUT_STATUS.PENDING,
        });
      }

      if (created.length) await tx.payouts.createMany({ data: created });

      return {
        periodStart: start,
        periodEnd: end,
        created: created.length,
        skipped,
        totalNet: created.reduce((s, c) => s + c.net_amount, 0),
      };
    });
  }

  /** Mark one payout paid. Idempotent: paying an already-paid row is rejected. */
  async pay(id: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.payouts.findUnique({ where: { id }, include: { partners: true } });
      if (!payout) throw new NotFoundException(`ບໍ່ພົບລາຍການໂອນ #${id} · Payout not found`);
      if (payout.status === PAYOUT_STATUS.PAID) {
        throw new BadRequestException('ໂອນໄປແລ້ວ · This payout has already been paid');
      }

      const updated = await tx.payouts.update({
        where: { id },
        data: { status: PAYOUT_STATUS.PAID, paid_at: new Date() },
      });

      await tx.notifications.create({
        data: {
          recipient_type: 'partner',
          recipient_id: payout.partner_id,
          title: 'ໂອນເງິນສຳເລັດ',
          body: `ໂອນ ₭${payout.net_amount.toLocaleString('en-US')} ເຂົ້າບັນຊີ ${payout.partners.bank_name ?? ''} ແລ້ວ`,
          type: 'payment',
        },
      });

      return updated;
    });
  }

  /** Pay every pending payout in one go — the "ຈ່າຍທັງໝົດ" button. */
  async payAll() {
    return this.prisma.$transaction(async (tx) => {
      const pending = await tx.payouts.findMany({
        where: { status: PAYOUT_STATUS.PENDING },
        include: { partners: { select: { id: true, bank_name: true } } },
      });

      if (!pending.length) return { paid: 0, totalNet: 0 };

      const now = new Date();
      await tx.payouts.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: { status: PAYOUT_STATUS.PAID, paid_at: now },
      });

      await tx.notifications.createMany({
        data: pending.map((p) => ({
          recipient_type: 'partner',
          recipient_id: p.partner_id,
          title: 'ໂອນເງິນສຳເລັດ',
          body: `ໂອນ ₭${p.net_amount.toLocaleString('en-US')} ເຂົ້າບັນຊີ ${p.partners.bank_name ?? ''} ແລ້ວ`,
          type: 'payment',
        })),
      });

      return { paid: pending.length, totalNet: pending.reduce((s, p) => s + p.net_amount, 0) };
    });
  }

  private async bookingCountsFor(
    payouts: { partner_id: bigint; period_start: Date; period_end: Date }[],
  ) {
    if (!payouts.length) return new Map<string, number>();

    const min = new Date(Math.min(...payouts.map((p) => p.period_start.getTime())));
    const max = addDaysUtc(new Date(Math.max(...payouts.map((p) => p.period_end.getTime()))), 1);

    // The week key comes back as text: letting `pg` parse a `date` would give a
    // local-midnight Date, which no longer matches Prisma's UTC-midnight
    // period_start once the server sits east or west of UTC.
    const rows = await this.prisma.$queryRaw<
      { partner_id: bigint; period_start: string; n: bigint }[]
    >`
      SELECT p.partner_id,
             to_char(date_trunc('week', b.check_out), 'YYYY-MM-DD') AS period_start,
             COUNT(*)::bigint                                       AS n
      FROM bookings b
      JOIN properties p ON p.id = b.property_id
      WHERE b.status = ${BOOKING_STATUS.DONE}
        AND b.check_out >= ${min} AND b.check_out < ${max}
      GROUP BY 1, 2
    `;

    return new Map(rows.map((r) => [`${r.partner_id}|${r.period_start}`, Number(r.n)]));
  }
}

/** Never send a full bank account number to the browser. */
function maskAccount(account: string | null): string | null {
  if (!account) return null;
  const tail = account.slice(-4);
  return `***${tail}`;
}
