import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../common/settings.service';
import {
  BOOKING_STATUS,
  PARTNER_STATUS,
  PAYOUT_STATUS,
  REVENUE_STATUSES,
  percentChange,
  rateForSource,
  percentOf,
  bookingCode,
} from '../../common/money';
import { addDaysUtc, daysAgoUtc, isoDayUtc } from '../../common/dates';

/** Start of the month `offset` months back, in local time. */
function monthStart(offset = 0): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - offset, 1, 0, 0, 0, 0);
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** The four cards across the top of the dashboard. */
  async kpis() {
    const { commission_rate, walkin_commission_rate } = await this.settings.get();
    const thisMonth = monthStart(0);
    const lastMonth = monthStart(1);

    const [revenueNow, revenuePrev, bookingsNow, bookingsToday, partnersNow, partnersPending] =
      await Promise.all([
        this.revenueBetween(thisMonth, null),
        this.revenueBetween(lastMonth, thisMonth),
        this.prisma.bookings.count({ where: { created_at: { gte: thisMonth } } }),
        this.prisma.bookings.count({ where: { created_at: { gte: startOfToday() } } }),
        this.prisma.partners.count({ where: { created_at: { gte: thisMonth } } }),
        this.prisma.partners.count({ where: { status: PARTNER_STATUS.PENDING } }),
      ]);

    const commissionNow = commissionOf(revenueNow, commission_rate, walkin_commission_rate);
    const commissionPrev = commissionOf(revenuePrev, commission_rate, walkin_commission_rate);

    return {
      revenue: {
        value: revenueNow.total,
        deltaPercent: percentChange(revenueNow.total, revenuePrev.total),
      },
      commission: {
        value: commissionNow,
        deltaPercent: percentChange(commissionNow, commissionPrev),
      },
      bookings: { value: bookingsNow, today: bookingsToday },
      newPartners: { value: partnersNow, pendingApprovals: partnersPending },
    };
  }

  /** Daily GMV for the bar chart. Days with no bookings are returned as zero. */
  async gmv(days = 14) {
    const since = daysAgoUtc(days - 1);

    // The day is returned as text so it keys the same regardless of the
    // server's timezone — see src/common/dates.ts.
    const rows = await this.prisma.$queryRaw<{ day: string; total: bigint }[]>`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(total), 0)::bigint                      AS total
      FROM bookings
      WHERE created_at >= ${since}
        AND status = ANY(${REVENUE_STATUSES}::varchar[])
      GROUP BY 1
      ORDER BY 1
    `;

    const byDay = new Map(rows.map((r) => [r.day, Number(r.total)]));

    const series: { date: string; total: number }[] = [];
    for (let i = 0; i < days; i++) {
      const key = isoDayUtc(addDaysUtc(since, i));
      series.push({ date: key, total: byDay.get(key) ?? 0 });
    }

    const peak = Math.max(1, ...series.map((s) => s.total));
    return {
      days,
      peak,
      // heightPercent saves the chart component from recomputing the scale
      series: series.map((s) => ({ ...s, heightPercent: Math.round((s.total / peak) * 100) })),
    };
  }

  /** The "Recent bookings" table at the bottom of the dashboard. */
  async recentBookings(limit = 5) {
    const rows = await this.prisma.bookings.findMany({
      take: limit,
      orderBy: { created_at: 'desc' },
      include: {
        properties: { select: { name: true } },
        users: { select: { full_name: true } },
      },
    });

    return rows.map((b) => ({
      id: b.id,
      code: bookingCode(b.id),
      property: b.properties.name,
      guest: b.users.full_name,
      checkIn: b.check_in,
      checkOut: b.check_out,
      total: b.total,
      status: b.status,
    }));
  }

  /** The dark "amount owed to partners" card next to the chart. */
  async payoutSummary() {
    const pending = await this.prisma.payouts.aggregate({
      where: { status: PAYOUT_STATUS.PENDING },
      _sum: { net_amount: true },
      _count: true,
    });

    const range = await this.prisma.payouts.aggregate({
      where: { status: PAYOUT_STATUS.PENDING },
      _min: { period_start: true },
      _max: { period_end: true },
    });

    const partners = await this.prisma.payouts.findMany({
      where: { status: PAYOUT_STATUS.PENDING },
      distinct: ['partner_id'],
      select: { partner_id: true },
    });

    return {
      pendingTotal: pending._sum.net_amount ?? 0,
      payoutCount: pending._count,
      partnerCount: partners.length,
      periodStart: range._min.period_start,
      periodEnd: range._max.period_end,
    };
  }

  /**
   * Revenue split by booking source, because app and walk-in bookings are
   * commissioned at different rates.
   */
  private async revenueBetween(from: Date, to: Date | null) {
    const rows = await this.prisma.bookings.groupBy({
      by: ['source'],
      where: {
        created_at: to ? { gte: from, lt: to } : { gte: from },
        status: { in: [...REVENUE_STATUSES] },
      },
      _sum: { total: true },
    });

    const bySource: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const amount = r._sum.total ?? 0;
      bySource[r.source ?? 'app'] = amount;
      total += amount;
    }
    return { total, bySource };
  }
}

function commissionOf(
  revenue: { bySource: Record<string, number> },
  appRate: number,
  walkInRate: number,
): number {
  let sum = 0;
  for (const [source, amount] of Object.entries(revenue.bySource)) {
    sum += percentOf(amount, rateForSource(source, appRate, walkInRate));
  }
  return sum;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// `bookingCode` moved to common/money.ts once the partner and customer APIs
// started needing it too. Re-exported here for the modules that already import
// it from this file.
export { BOOKING_STATUS, bookingCode };
