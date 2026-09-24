import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnershipService } from '../ownership.service';
import { kipOf } from '../../common/money';
import { addDaysUtc, isoDayUtc, parseDateRange, startOfWeekUtc, utcMidnight } from '../../common/dates';
import { REVENUE_STATUSES } from '../../common/enums';
import type { ReportBucket, ReportQueryDto } from './reports.dto';

interface SeriesPoint {
  bucket: string;
  [metric: string]: string | number | null;
}

interface BreakdownRow {
  label: string;
  [metric: string]: string | number;
}

interface ReportEnvelope<K> {
  range: { from: string; to: string; bucket: ReportBucket };
  kpis: K;
  series: SeriesPoint[];
  breakdown: BreakdownRow[];
}

/**
 * `/partner/reports/*` — date-range aggregation for a partner's own
 * properties. Every method fetches the raw rows for the range (at most 366
 * days, per `parseDateRange`) and buckets/sums them in application code
 * rather than in SQL: at this scale (one partner, one year, at most a few
 * thousand rows) that is simpler and easier to unit test than a
 * `generate_series` query per report, and it means no report here needs raw
 * SQL at all.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly own: OwnershipService,
  ) {}

  async revenue(partnerId: bigint, query: ReportQueryDto) {
    const { from, to } = parseDateRange(query.from, query.to);
    const bucket = query.bucket ?? 'day';
    const propertyIds = await this.resolveScope(partnerId, query.propertyId);

    const kpis = {
      gross: 0,
      discount: 0,
      tax: 0,
      serviceFee: 0,
      cleaningFee: 0,
      commission: 0,
      net: 0,
      bookings: 0,
    };
    type Accum = { gross: number; commission: number; net: number; bookings: number };
    const acc = this.emptySeries<Accum>(from, to, bucket, () => ({
      gross: 0,
      commission: 0,
      net: 0,
      bookings: 0,
    }));

    if (!propertyIds.length) {
      return this.envelope(from, to, bucket, kpis, finalizeSeries(acc, (v) => v), []);
    }

    const rows = await this.prisma.bookings.findMany({
      where: {
        property_id: { in: propertyIds },
        deleted_at: null,
        status: { in: REVENUE_STATUSES },
        check_out: { gte: from, lt: to },
      },
      select: {
        property_id: true,
        check_out: true,
        subtotal_amount: true,
        discount_amount: true,
        tax_amount: true,
        service_fee: true,
        cleaning_fee: true,
        commission_amount: true,
        total_amount: true,
        payout_amount: true,
      },
    });

    const byProperty = new Map<string, number>();

    for (const b of rows) {
      kpis.bookings += 1;
      kpis.gross += kipOf(b.total_amount);
      kpis.discount += kipOf(b.discount_amount);
      kpis.tax += kipOf(b.tax_amount);
      kpis.serviceFee += kipOf(b.service_fee);
      kpis.cleaningFee += kipOf(b.cleaning_fee);
      kpis.commission += kipOf(b.commission_amount);
      kpis.net += kipOf(b.payout_amount);

      const point = acc.get(bucketKey(b.check_out, bucket));
      if (point) {
        point.gross += kipOf(b.total_amount);
        point.commission += kipOf(b.commission_amount);
        point.net += kipOf(b.payout_amount);
        point.bookings += 1;
      }

      const pid = b.property_id.toString();
      byProperty.set(pid, (byProperty.get(pid) ?? 0) + kipOf(b.total_amount));
    }

    const breakdown =
      propertyIds.length > 1
        ? await this.propertyBreakdown(propertyIds, byProperty, 'gross')
        : await this.roomTypeRevenueBreakdown(propertyIds[0], from, to);

    return this.envelope(from, to, bucket, kpis, finalizeSeries(acc, (v) => v), breakdown);
  }

  async payouts(partnerId: bigint, query: ReportQueryDto) {
    const { from, to } = parseDateRange(query.from, query.to);
    const bucket = query.bucket ?? 'day';

    const kpis = { gross: 0, commission: 0, net: 0, count: 0 };
    type Accum = { gross: number; commission: number; net: number };
    const acc = this.emptySeries<Accum>(from, to, bucket, () => ({ gross: 0, commission: 0, net: 0 }));
    const byStatus = new Map<string, { count: number; net: number }>();

    const rows = await this.prisma.payouts.findMany({
      where: { partner_id: partnerId, period_start: { gte: from, lt: to } },
      select: {
        period_start: true,
        gross_amount: true,
        commission_amount: true,
        net_amount: true,
        status: true,
      },
      orderBy: { period_start: 'asc' },
    });

    for (const p of rows) {
      kpis.count += 1;
      kpis.gross += kipOf(p.gross_amount);
      kpis.commission += kipOf(p.commission_amount);
      kpis.net += kipOf(p.net_amount);

      const point = acc.get(bucketKey(p.period_start, bucket));
      if (point) {
        point.gross += kipOf(p.gross_amount);
        point.commission += kipOf(p.commission_amount);
        point.net += kipOf(p.net_amount);
      }

      const entry = byStatus.get(p.status) ?? { count: 0, net: 0 };
      entry.count += 1;
      entry.net += kipOf(p.net_amount);
      byStatus.set(p.status, entry);
    }

    const breakdown: BreakdownRow[] = [...byStatus.entries()].map(([status, v]) => ({
      label: status,
      count: v.count,
      net: v.net,
    }));

    return this.envelope(from, to, bucket, kpis, finalizeSeries(acc, (v) => v), breakdown);
  }

  async bookings(partnerId: bigint, query: ReportQueryDto) {
    const { from, to } = parseDateRange(query.from, query.to);
    const bucket = query.bucket ?? 'day';
    const propertyIds = await this.resolveScope(partnerId, query.propertyId);

    let total = 0;
    let app = 0;
    let walkIn = 0;
    const byStatus = new Map<string, number>();
    const byRoomType = new Map<string, { label: string; count: number }>();
    type Accum = { total: number };
    const acc = this.emptySeries<Accum>(from, to, bucket, () => ({ total: 0 }));

    if (propertyIds.length) {
      const rows = await this.prisma.bookings.findMany({
        where: {
          property_id: { in: propertyIds },
          deleted_at: null,
          created_at: { gte: from, lt: to },
        },
        select: {
          status: true,
          source: true,
          created_at: true,
          booking_items: {
            select: { room_type_id: true, room_types: { select: { type_name: true } } },
          },
        },
      });

      for (const b of rows) {
        total += 1;
        if (b.source === 'app') app += 1;
        else walkIn += 1;

        byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + 1);

        const point = acc.get(bucketKey(b.created_at, bucket));
        if (point) point.total += 1;

        const item = b.booking_items[0];
        if (item) {
          const key = item.room_type_id.toString();
          const entry = byRoomType.get(key) ?? { label: item.room_types.type_name, count: 0 };
          entry.count += 1;
          byRoomType.set(key, entry);
        }
      }
    }

    const kpis = { total, app, walkIn, byStatus: Object.fromEntries(byStatus) };
    const breakdown: BreakdownRow[] = [...byRoomType.values()]
      .sort((a, b) => b.count - a.count)
      .map((r) => ({ label: r.label, count: r.count }));

    return this.envelope(from, to, bucket, kpis, finalizeSeries(acc, (v) => v), breakdown);
  }

  async occupancy(partnerId: bigint, query: ReportQueryDto) {
    const { from, to } = parseDateRange(query.from, query.to);
    const bucket = query.bucket ?? 'day';
    const propertyIds = await this.resolveScope(partnerId, query.propertyId);

    let soldRoomNights = 0;
    let availableRoomNights = 0;
    type Accum = { sold: number; available: number };
    const acc = this.emptySeries<Accum>(from, to, bucket, () => ({ sold: 0, available: 0 }));
    const byRoomType = new Map<string, { label: string; sold: number; available: number }>();
    const byProperty = new Map<string, { sold: number; available: number }>();

    if (propertyIds.length) {
      const rows = await this.prisma.room_inventory.findMany({
        where: { room_types: { property_id: { in: propertyIds } }, date: { gte: from, lt: to } },
        select: {
          date: true,
          total_count: true,
          booked_count: true,
          room_type_id: true,
          room_types: { select: { type_name: true, property_id: true } },
        },
      });

      for (const r of rows) {
        soldRoomNights += r.booked_count;
        availableRoomNights += r.total_count;

        const point = acc.get(bucketKey(r.date, bucket));
        if (point) {
          point.sold += r.booked_count;
          point.available += r.total_count;
        }

        const typeKey = r.room_type_id.toString();
        const typeEntry = byRoomType.get(typeKey) ?? {
          label: r.room_types.type_name,
          sold: 0,
          available: 0,
        };
        typeEntry.sold += r.booked_count;
        typeEntry.available += r.total_count;
        byRoomType.set(typeKey, typeEntry);

        const propKey = r.room_types.property_id.toString();
        const propEntry = byProperty.get(propKey) ?? { sold: 0, available: 0 };
        propEntry.sold += r.booked_count;
        propEntry.available += r.total_count;
        byProperty.set(propKey, propEntry);
      }
    }

    const kpis = {
      soldRoomNights,
      availableRoomNights,
      occupancyPercent: availableRoomNights
        ? Math.round((soldRoomNights / availableRoomNights) * 100)
        : 0,
    };

    const percentOf = (sold: number, available: number) =>
      available ? Math.round((sold / available) * 100) : 0;

    let breakdown: BreakdownRow[];
    if (propertyIds.length > 1) {
      const names = await this.propertyNames(propertyIds);
      breakdown = [...byProperty.entries()].map(([id, v]) => ({
        label: names.get(id) ?? id,
        sold: v.sold,
        available: v.available,
        percent: percentOf(v.sold, v.available),
      }));
    } else {
      breakdown = [...byRoomType.values()].map((v) => ({
        label: v.label,
        sold: v.sold,
        available: v.available,
        percent: percentOf(v.sold, v.available),
      }));
    }

    const series = finalizeSeries(acc, (v) => ({ ...v, percent: percentOf(v.sold, v.available) }));
    return this.envelope(from, to, bucket, kpis, series, breakdown);
  }

  async cancellations(partnerId: bigint, query: ReportQueryDto) {
    const { from, to } = parseDateRange(query.from, query.to);
    const bucket = query.bucket ?? 'day';
    const propertyIds = await this.resolveScope(partnerId, query.propertyId);

    const kpis = { count: 0, penalty: 0, refunded: 0 };
    type Accum = { count: number; penalty: number; refunded: number };
    const acc = this.emptySeries<Accum>(from, to, bucket, () => ({ count: 0, penalty: 0, refunded: 0 }));
    let breakdown: BreakdownRow[] = [];

    if (propertyIds.length) {
      const [cancellations, refundRows] = await Promise.all([
        this.prisma.booking_cancellations.findMany({
          where: {
            bookings: { property_id: { in: propertyIds } },
            cancelled_at: { gte: from, lt: to },
          },
          select: { cancelled_at: true, penalty_amount: true, refund_amount: true },
        }),
        this.prisma.refunds.groupBy({
          by: ['status'],
          where: {
            bookings: { property_id: { in: propertyIds } },
            created_at: { gte: from, lt: to },
          },
          _count: true,
          _sum: { amount: true },
        }),
      ]);

      for (const c of cancellations) {
        kpis.count += 1;
        kpis.penalty += kipOf(c.penalty_amount);
        kpis.refunded += kipOf(c.refund_amount);

        const point = acc.get(bucketKey(c.cancelled_at, bucket));
        if (point) {
          point.count += 1;
          point.penalty += kipOf(c.penalty_amount);
          point.refunded += kipOf(c.refund_amount);
        }
      }

      breakdown = refundRows.map((r) => ({
        label: r.status,
        count: r._count,
        amount: kipOf(r._sum.amount ?? 0n),
      }));
    }

    return this.envelope(from, to, bucket, kpis, finalizeSeries(acc, (v) => v), breakdown);
  }

  async reviews(partnerId: bigint, query: ReportQueryDto) {
    const { from, to } = parseDateRange(query.from, query.to);
    const bucket = query.bucket ?? 'day';
    const propertyIds = await this.resolveScope(partnerId, query.propertyId);

    let count = 0;
    let ratingSum = 0;
    const distribution = new Map<number, number>([1, 2, 3, 4, 5].map((star) => [star, 0]));
    type Accum = { count: number; ratingSum: number };
    const acc = this.emptySeries<Accum>(from, to, bucket, () => ({ count: 0, ratingSum: 0 }));

    if (propertyIds.length) {
      const rows = await this.prisma.reviews.findMany({
        where: { property_id: { in: propertyIds }, status: 'published', created_at: { gte: from, lt: to } },
        select: { created_at: true, overall_rating: true },
      });

      for (const r of rows) {
        const rating = Number(r.overall_rating.toString());
        count += 1;
        ratingSum += rating;

        const star = Math.min(5, Math.max(1, Math.floor(rating)));
        distribution.set(star, (distribution.get(star) ?? 0) + 1);

        const point = acc.get(bucketKey(r.created_at, bucket));
        if (point) {
          point.count += 1;
          point.ratingSum += rating;
        }
      }
    }

    const kpis = {
      count,
      averageOverall: count ? Number((ratingSum / count).toFixed(2)) : null,
    };
    const series = finalizeSeries(acc, (v) => ({
      count: v.count,
      average: v.count ? Number((v.ratingSum / v.count).toFixed(2)) : null,
    }));
    const breakdown = this.distributionRows(distribution);

    return this.envelope(from, to, bucket, kpis, series, breakdown);
  }

  async promotions(partnerId: bigint, query: ReportQueryDto) {
    const { from, to } = parseDateRange(query.from, query.to);
    const bucket = query.bucket ?? 'day';
    const propertyIds = await this.resolveScope(partnerId, query.propertyId);

    const kpis = { discountGiven: 0, couponUses: 0 };
    type Accum = { discount: number; uses: number };
    const acc = this.emptySeries<Accum>(from, to, bucket, () => ({ discount: 0, uses: 0 }));
    const byCoupon = new Map<string, { label: string; uses: number; discount: number }>();

    if (propertyIds.length) {
      const rows = await this.prisma.coupon_usages.findMany({
        where: { bookings: { property_id: { in: propertyIds } }, used_at: { gte: from, lt: to } },
        select: { used_at: true, discount_amount: true, coupons: { select: { coupon_code: true } } },
      });

      for (const u of rows) {
        kpis.couponUses += 1;
        kpis.discountGiven += kipOf(u.discount_amount);

        const point = acc.get(bucketKey(u.used_at, bucket));
        if (point) {
          point.uses += 1;
          point.discount += kipOf(u.discount_amount);
        }

        const code = u.coupons.coupon_code;
        const entry = byCoupon.get(code) ?? { label: code, uses: 0, discount: 0 };
        entry.uses += 1;
        entry.discount += kipOf(u.discount_amount);
        byCoupon.set(code, entry);
      }
    }

    const breakdown: BreakdownRow[] = [...byCoupon.values()]
      .sort((a, b) => b.discount - a.discount)
      .slice(0, 20)
      .map((c) => ({ label: c.label, uses: c.uses, discount: c.discount }));

    return this.envelope(from, to, bucket, kpis, finalizeSeries(acc, (v) => v), breakdown);
  }

  // ── shared helpers ────────────────────────────────────────────────────────

  /** Every owned property, or just one when `propertyId` is given and owned. */
  private async resolveScope(partnerId: bigint, propertyId?: number): Promise<bigint[]> {
    if (propertyId !== undefined) {
      const id = BigInt(propertyId);
      await this.own.assertOwnsProperty(partnerId, id);
      return [id];
    }
    return this.own.propertyIds(partnerId);
  }

  private async propertyNames(propertyIds: bigint[]): Promise<Map<string, string>> {
    const rows = await this.prisma.properties.findMany({
      where: { property_id: { in: propertyIds } },
      select: { property_id: true, property_name: true },
    });
    return new Map(rows.map((r) => [r.property_id.toString(), r.property_name]));
  }

  private async propertyBreakdown(
    propertyIds: bigint[],
    amountsById: Map<string, number>,
    metric: string,
  ): Promise<BreakdownRow[]> {
    const names = await this.propertyNames(propertyIds);
    return propertyIds
      .map((id) => {
        const key = id.toString();
        return { label: names.get(key) ?? key, [metric]: amountsById.get(key) ?? 0 };
      })
      .sort((a, b) => (b[metric] as number) - (a[metric] as number));
  }

  private async roomTypeRevenueBreakdown(
    propertyId: bigint,
    from: Date,
    to: Date,
  ): Promise<BreakdownRow[]> {
    const items = await this.prisma.booking_items.findMany({
      where: {
        bookings: {
          property_id: propertyId,
          deleted_at: null,
          status: { in: REVENUE_STATUSES },
          check_out: { gte: from, lt: to },
        },
      },
      select: { subtotal: true, room_types: { select: { type_name: true } } },
    });
    const byType = new Map<string, number>();
    for (const i of items) {
      byType.set(i.room_types.type_name, (byType.get(i.room_types.type_name) ?? 0) + kipOf(i.subtotal));
    }
    return [...byType.entries()]
      .map(([label, gross]) => ({ label, gross }))
      .sort((a, b) => b.gross - a.gross);
  }

  private distributionRows(distribution: Map<number, number>): BreakdownRow[] {
    return [...distribution.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([star, count]) => ({ label: `${star}★`, count }));
  }

  /** One zeroed entry per bucket key in `[from, to)`, in chronological order. */
  private emptySeries<T>(from: Date, to: Date, bucket: ReportBucket, seed: () => T): Map<string, T> {
    const map = new Map<string, T>();
    for (let d = new Date(from); d < to; d = addDaysUtc(d, 1)) {
      const key = bucketKey(d, bucket);
      if (!map.has(key)) map.set(key, seed());
    }
    return map;
  }

  private envelope<K>(
    from: Date,
    to: Date,
    bucket: ReportBucket,
    kpis: K,
    series: SeriesPoint[],
    breakdown: BreakdownRow[],
  ): ReportEnvelope<K> {
    return { range: { from: isoDayUtc(from), to: isoDayUtc(to), bucket }, kpis, series, breakdown };
  }
}

/** The bucket key a given calendar day falls into. */
function bucketKey(date: Date, bucket: ReportBucket): string {
  const d = utcMidnight(date);
  if (bucket === 'day') return isoDayUtc(d);
  if (bucket === 'week') return isoDayUtc(startOfWeekUtc(d));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Turns an accumulator map into the ordered `series` array the client gets. */
function finalizeSeries<T>(
  acc: Map<string, T>,
  finalize: (v: T) => Record<string, number | null>,
): SeriesPoint[] {
  return [...acc.entries()].map(([bucket, v]) => ({ bucket, ...finalize(v) }));
}
