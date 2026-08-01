import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { OwnershipService } from '../ownership.service';
import { Actor, CurrentPartner, type AuthedPartner } from '../../common/decorators';
import { ACTOR } from '../../common/actors';
import {
  BOOKING_STATUS,
  PAYOUT_STATUS,
  REVENUE_STATUSES,
  bookingCode,
  percentOf,
  rateForSource,
} from '../../common/money';
import { addDaysUtc, startOfWeekUtc, todayUtc } from '../../common/dates';

/**
 * The partner app's home screen: what is happening today, and what the week has
 * earned. Every figure is scoped to this partner's own properties.
 */
@Controller('partner/dashboard')
@Actor(ACTOR.PARTNER)
export class PartnerDashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly own: OwnershipService,
  ) {}

  @Get()
  async get(@CurrentPartner() partner: AuthedPartner) {
    const propertyIds = await this.own.propertyIds(partner.id);
    if (!propertyIds.length) {
      return emptyDashboard(partner);
    }

    const today = todayUtc();
    const tomorrow = addDaysUtc(today, 1);
    const weekStart = startOfWeekUtc(today);
    const weekEnd = addDaysUtc(weekStart, 7);

    const scope = { property_id: { in: propertyIds } };
    const { commission_rate, walkin_commission_rate } = await this.settings.get();

    const [arrivals, departures, staying, pendingCount, weekBookings, rooms, pendingPayout, unread] =
      await Promise.all([
        this.prisma.bookings.findMany({
          where: { ...scope, check_in: today, status: { not: BOOKING_STATUS.CANCELLED } },
          include: {
            users: { select: { full_name: true, phone: true } },
            rooms: { select: { name: true, room_no: true } },
          },
          orderBy: { id: 'asc' },
        }),
        this.prisma.bookings.count({
          where: { ...scope, check_out: today, status: BOOKING_STATUS.STAYING },
        }),
        this.prisma.bookings.count({ where: { ...scope, status: BOOKING_STATUS.STAYING } }),
        this.prisma.bookings.count({ where: { ...scope, status: BOOKING_STATUS.PENDING } }),
        this.prisma.bookings.findMany({
          where: {
            ...scope,
            status: { in: REVENUE_STATUSES },
            check_out: { gte: weekStart, lt: weekEnd },
          },
          select: { total: true, source: true },
        }),
        this.prisma.rooms.findMany({
          where: { property_id: { in: propertyIds }, is_active: true },
          select: { id: true, qty: true },
        }),
        this.prisma.payouts.aggregate({
          where: { partner_id: partner.id, status: PAYOUT_STATUS.PENDING },
          _sum: { net_amount: true },
          _count: true,
        }),
        this.prisma.notifications.count({
          where: { recipient_type: ACTOR.PARTNER, recipient_id: partner.id, is_read: false },
        }),
      ]);

    // Gross for the week, and what the partner keeps after commission — applied
    // per booking so a mix of app and walk-in stays is costed exactly.
    const weekGmv = weekBookings.reduce((sum, b) => sum + b.total, 0);
    const weekCommission = weekBookings.reduce(
      (sum, b) => sum + percentOf(b.total, rateForSource(b.source, commission_rate, walkin_commission_rate)),
      0,
    );

    // Occupancy counts room-nights sold tonight against room-nights on sale.
    const capacity = rooms.reduce((sum, r) => sum + r.qty, 0);
    const soldTonight = await this.prisma.bookings.count({
      where: {
        ...scope,
        status: { in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.STAYING] },
        check_in: { lte: today },
        check_out: { gt: today },
      },
    });

    return {
      partner: { id: partner.id.toString(), ownerName: partner.ownerName, status: partner.status },
      today: {
        date: today,
        arrivals: arrivals.map((b) => ({
          id: b.id,
          code: bookingCode(b.id),
          guest: b.users.full_name,
          phone: b.users.phone,
          room: b.rooms.room_no ?? b.rooms.name,
          guests: b.guests,
          status: b.status,
        })),
        arrivalCount: arrivals.length,
        departureCount: departures,
        stayingCount: staying,
      },
      pendingBookings: pendingCount,
      occupancy: {
        soldTonight,
        capacity,
        percent: capacity ? Math.round((soldTonight / capacity) * 100) : 0,
      },
      week: {
        start: weekStart,
        end: addDaysUtc(weekEnd, -1),
        bookings: weekBookings.length,
        gmv: weekGmv,
        commission: weekCommission,
        // Subtraction, so gmv === commission + net exactly.
        net: weekGmv - weekCommission,
      },
      payoutPending: {
        count: pendingPayout._count,
        amount: pendingPayout._sum.net_amount ?? 0,
      },
      unreadNotifications: unread,
    };
  }
}

/** A partner whose application is still pending has no properties yet. */
function emptyDashboard(partner: AuthedPartner) {
  const today = todayUtc();
  const weekStart = startOfWeekUtc(today);
  return {
    partner: { id: partner.id.toString(), ownerName: partner.ownerName, status: partner.status },
    today: { date: today, arrivals: [], arrivalCount: 0, departureCount: 0, stayingCount: 0 },
    pendingBookings: 0,
    occupancy: { soldTonight: 0, capacity: 0, percent: 0 },
    week: { start: weekStart, end: addDaysUtc(weekStart, 6), bookings: 0, gmv: 0, commission: 0, net: 0 },
    payoutPending: { count: 0, amount: 0 },
    unreadNotifications: 0,
  };
}
