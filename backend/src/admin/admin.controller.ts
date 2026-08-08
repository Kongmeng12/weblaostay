import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  admin_role,
  booking_status,
  partner_status,
  payout_status,
  review_status,
  user_role,
  user_status,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../common/settings.service';
import { PayoutService } from './payout.service';
import { BookingService } from '../booking/booking.service';
import { PasswordService } from '../auth/password.service';
import { AdminRoles, Audit, CurrentUser, Roles, type AuthedUser } from '../common/decorators';
import { MONEY_ROLES, REVENUE_STATUSES } from '../common/enums';
import { kipOf, rateOf } from '../common/money';
import { isoDayUtc } from '../common/dates';
import { PaginationDto, paged } from '../common/dto/pagination.dto';
import { CancelBookingDto } from '../booking/booking.dto';

class ListPartnersDto extends PaginationDto {
  @IsOptional()
  @IsEnum(partner_status)
  status?: partner_status;

  /** Matches partners with at least one property in that province. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  provinceId?: number;
}

class ListBookingsAdminDto extends PaginationDto {
  @IsOptional()
  @IsEnum(booking_status)
  status?: booking_status;
}

class ListCustomersDto extends PaginationDto {
  @IsOptional()
  @IsEnum(user_status)
  status?: user_status;
}

class ListReviewsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(review_status)
  status?: review_status;
}

class RejectDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

class SetUserStatusDto {
  @IsEnum(user_status)
  status!: user_status;
}

class GeneratePayoutDto {
  @IsOptional()
  @IsString()
  periodStart?: string;
}

class UpdateSettingsDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) commission_rate_app?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) commission_rate_walkin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) service_fee_rate?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) tax_rate?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1440) hold_ttl_minutes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) max_nights_per_booking?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) qr_ttl_minutes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31) payout_period_days?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) login_max_attempts?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1440) login_lockout_minutes?: number;

  /**
   * The user-facing strings from `app_settings` — platform name, contact
   * details. Free-form because the set of keys is data, not code; unknown keys
   * are dropped by the service rather than created.
   */
  @IsOptional()
  @IsObject()
  app?: Record<string, string>;
}

class AuditQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;
}

class GmvQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  days: number = 14;
}

class CreateAdminDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsEnum(admin_role)
  adminRole!: admin_role;
}

@Controller('admin')
@Roles(user_role.ADMIN)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly payouts: PayoutService,
    private readonly bookings: BookingService,
    private readonly passwords: PasswordService,
  ) {}

  // ── dashboard ─────────────────────────────────────────────────────────────

  @Get('dashboard')
  async dashboard() {
    const [bookingAgg, pendingPartners, activeProperties, pendingPayouts, statusRows] =
      await Promise.all([
        this.prisma.bookings.aggregate({
          where: { status: { in: [booking_status.confirmed, booking_status.staying, booking_status.completed] } },
          _sum: { total_amount: true, commission_amount: true },
          _count: true,
        }),
        this.prisma.partners.count({ where: { status: partner_status.pending } }),
        this.prisma.properties.count({ where: { status: 'active', deleted_at: null } }),
        this.prisma.payouts.aggregate({
          where: { status: payout_status.pending },
          _sum: { net_amount: true },
          _count: true,
        }),
        this.prisma.bookings.groupBy({ by: ['status'], _count: true }),
      ]);

    return {
      gmv: kipOf(bookingAgg._sum.total_amount ?? 0n),
      commission: kipOf(bookingAgg._sum.commission_amount ?? 0n),
      bookings: bookingAgg._count,
      bookingsByStatus: Object.fromEntries(statusRows.map((r) => [r.status, r._count])),
      pendingApprovals: pendingPartners,
      activeProperties,
      pendingPayouts: {
        count: pendingPayouts._count,
        amount: kipOf(pendingPayouts._sum.net_amount ?? 0n),
      },
    };
  }

  /**
   * Daily takings for the dashboard chart.
   *
   * Grouped in SQL rather than in JS: pulling months of bookings back just to
   * bucket them by day is a lot of rows to move for fourteen numbers. Days with
   * no bookings are filled in here, because a chart that silently skips them
   * draws a flat line where there was actually a gap.
   */
  @Get('dashboard/gmv')
  async gmvSeries(@Query() query: GmvQueryDto) {
    const rows = await this.prisma.$queryRaw<{ day: Date; total: bigint; bookings: bigint }[]>`
      SELECT d::date                      AS day,
             COALESCE(sum(b.total_amount), 0)::bigint AS total,
             count(b.booking_id)::bigint             AS bookings
      FROM generate_series(
             CURRENT_DATE - (${query.days}::int - 1),
             CURRENT_DATE,
             '1 day'
           ) AS d
      LEFT JOIN bookings b
        ON b.created_at >= d::date
       AND b.created_at <  d::date + 1
       AND b.deleted_at IS NULL
       AND b.status IN ('confirmed', 'staying', 'completed')
      GROUP BY d
      ORDER BY d
    `;

    const series = rows.map((r) => ({
      date: isoDayUtc(r.day),
      total: kipOf(r.total),
      bookings: Number(r.bookings),
    }));
    const peak = series.reduce((m, s) => Math.max(m, s.total), 0);

    return {
      days: query.days,
      peak,
      total: series.reduce((sum, s) => sum + s.total, 0),
      // The bar heights, so every client draws the same chart rather than each
      // reinventing the scaling.
      series: series.map((s) => ({
        ...s,
        heightPercent: peak === 0 ? 0 : Math.round((s.total / peak) * 100),
      })),
    };
  }

  // ── partner approvals ─────────────────────────────────────────────────────

  @Get('approvals')
  async approvals() {
    const rows = await this.prisma.partners.findMany({
      where: { status: partner_status.pending, deleted_at: null },
      orderBy: { created_at: 'desc' },
      include: {
        users: { include: { user_profiles: { select: { full_name: true } } } },
        partner_documents: true,
        properties: {
          select: {
            property_id: true,
            property_name: true,
            property_type: true,
            address_detail: true,
            provinces: { select: { province_name_lo: true } },
          },
        },
      },
    });

    return rows.map((p) => ({
      id: p.partner_id.toString(),
      businessName: p.business_name,
      ownerName: p.users.user_profiles?.full_name ?? null,
      email: p.users.email,
      phone: p.contact_phone,
      appliedAt: p.created_at,
      documents: p.partner_documents.map((d) => ({
        id: d.document_id.toString(),
        type: d.document_type,
        url: d.file_url,
        status: d.status,
      })),
      properties: p.properties.map((pr) => ({
        id: pr.property_id.toString(),
        name: pr.property_name,
        type: pr.property_type,
        province: pr.provinces?.province_name_lo ?? null,
        address: pr.address_detail,
      })),
    }));
  }

  @Get('approvals/counts')
  async approvalCounts() {
    const rows = await this.prisma.partners.groupBy({ by: ['status'], _count: true });
    return Object.fromEntries(rows.map((r) => [r.status, r._count]));
  }

  /**
   * Approving a partner also puts their properties on sale — a verified partner
   * whose listings are still `draft` is invisible, which looks like the
   * approval silently failed.
   */
  @Patch('approvals/:id/approve')
  @Audit('approve_partner', 'admin', 'partners')
  async approve(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.decide(BigInt(id), partner_status.verified, user.userId, {
      title: 'ອະນຸມັດແລ້ວ! 🎉',
      message: 'ໃບສະໝັກທີ່ພັກຂອງທ່ານຜ່ານການອະນຸມັດ — ເລີ່ມຮັບການຈອງໄດ້ເລີຍ',
    });
  }

  @Patch('approvals/:id/reject')
  @Audit('reject_partner', 'admin', 'partners')
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.decide(BigInt(id), partner_status.rejected, user.userId, {
      title: 'ໃບສະໝັກບໍ່ຜ່ານ',
      message: dto.reason?.slice(0, 500) ?? 'ໃບສະໝັກຂອງທ່ານຍັງບໍ່ຜ່ານ ກະລຸນາຕິດຕໍ່ຝ່າຍຊ່ວຍເຫຼືອ',
    });
  }

  private async decide(
    partnerId: bigint,
    status: partner_status,
    adminUserId: bigint,
    notice: { title: string; message: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const partner = await tx.partners.findUnique({ where: { partner_id: partnerId } });
      if (!partner) throw new BadRequestException(`ບໍ່ພົບ partner #${partnerId} · Partner not found`);

      // Guards against a double-click racing two decisions onto one application.
      if (partner.status !== partner_status.pending) {
        throw new BadRequestException(
          `ໃບສະໝັກນີ້ຕັດສິນໄປແລ້ວ (${partner.status}) · Application already decided`,
        );
      }

      const updated = await tx.partners.update({
        where: { partner_id: partnerId },
        data: {
          status,
          verified_at: status === partner_status.verified ? new Date() : null,
        },
      });

      if (status === partner_status.verified) {
        await tx.properties.updateMany({
          where: { partner_id: partnerId, status: 'draft', deleted_at: null },
          data: { status: 'active' },
        });
        await tx.partner_documents.updateMany({
          where: { partner_id: partnerId, status: 'pending' },
          data: { status: 'approved', reviewed_by: adminUserId, reviewed_at: new Date() },
        });
      }

      await tx.notifications.create({
        data: {
          user_id: partner.user_id,
          title: notice.title,
          message: notice.message,
          notification_type: 'system',
          reference_type: 'partner',
          reference_id: partnerId,
        },
      });

      return { id: updated.partner_id.toString(), status: updated.status };
    });
  }

  // ── partners, customers, bookings ─────────────────────────────────────────

  @Get('partners')
  async partners(@Query() query: ListPartnersDto) {
    const where = {
      deleted_at: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? { business_name: { contains: query.q.trim(), mode: 'insensitive' as const } }
        : {}),
      ...(query.provinceId
        ? { properties: { some: { province_id: query.provinceId, deleted_at: null } } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.partners.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        include: {
          users: { include: { user_profiles: { select: { full_name: true } } } },
          properties: {
            where: { deleted_at: null },
            select: {
              property_id: true,
              property_name: true,
              rating_avg: true,
              review_count: true,
              provinces: { select: { province_name_lo: true } },
              _count: { select: { room_types: true } },
            },
          },
          _count: { select: { payouts: true } },
        },
      }),
      this.prisma.partners.count({ where }),
    ]);

    // Lifetime takings, for this page of partners only — the same shape as the
    // customers list. Bookings carry `property_id`, so the sums come back per
    // property and are folded up to the partner here.
    const propertyIds = rows.flatMap((p) => p.properties.map((pr) => pr.property_id));
    const revenueRows = propertyIds.length
      ? await this.prisma.bookings.groupBy({
          by: ['property_id'],
          where: {
            property_id: { in: propertyIds },
            deleted_at: null,
            status: { in: REVENUE_STATUSES },
          },
          _sum: { total_amount: true },
        })
      : [];
    const revenueBy = new Map(
      revenueRows.map((r) => [r.property_id.toString(), r._sum.total_amount ?? 0n]),
    );

    return paged(
      rows.map((p) => {
        const reviewCount = p.properties.reduce((sum, pr) => sum + pr.review_count, 0);
        // Weighted by review count, so a property with three reviews does not
        // pull the average as hard as one with three hundred.
        const ratingTotal = p.properties.reduce(
          (sum, pr) => sum + rateOf(pr.rating_avg) * pr.review_count,
          0,
        );

        return {
          id: p.partner_id.toString(),
          businessName: p.business_name,
          ownerName: p.users.user_profiles?.full_name ?? null,
          email: p.users.email,
          phone: p.contact_phone,
          status: p.status,
          commissionRate: rateOf(p.default_commission_rate),
          propertyCount: p.properties.length,
          payoutCount: p._count.payouts,
          roomCount: p.properties.reduce((sum, pr) => sum + pr._count.room_types, 0),
          // The provinces they operate in, deduplicated — a partner is not
          // necessarily in only one.
          provinces: [
            ...new Set(
              p.properties.map((pr) => pr.provinces?.province_name_lo).filter((n): n is string => !!n),
            ),
          ],
          rating: reviewCount ? Math.round((ratingTotal / reviewCount) * 10) / 10 : null,
          reviewCount,
          revenue: kipOf(
            p.properties.reduce(
              (sum, pr) => sum + (revenueBy.get(pr.property_id.toString()) ?? 0n),
              0n,
            ),
          ),
          createdAt: p.created_at,
        };
      }),
      total,
      query,
    );
  }

  /**
   * Where the partners are. Declared before `partners/:id`-shaped routes would
   * be, so "provinces" is never read as an id.
   */
  @Get('partners/provinces')
  async partnersByProvince() {
    const rows = await this.prisma.$queryRaw<
      { province_id: number | null; province: string; count: bigint }[]
    >`
      SELECT pv.province_id,
             COALESCE(pv.province_name_lo, 'ບໍ່ລະບຸ') AS province,
             count(DISTINCT pt.partner_id)            AS count
      FROM partners pt
      JOIN properties pr ON pr.partner_id = pt.partner_id AND pr.deleted_at IS NULL
      LEFT JOIN provinces pv ON pv.province_id = pr.province_id
      WHERE pt.deleted_at IS NULL
      GROUP BY pv.province_id, pv.province_name_lo
      ORDER BY count DESC, province ASC
    `;
    return rows.map((r) => ({
      id: r.province_id,
      province: r.province,
      count: Number(r.count),
    }));
  }

  @Get('customers/summary')
  async customerSummary() {
    const rows = await this.prisma.users.groupBy({
      by: ['status'],
      where: { role: user_role.CUSTOMER, deleted_at: null },
      _count: true,
    });
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r._count]));
    return {
      total: rows.reduce((sum, r) => sum + r._count, 0),
      active: byStatus[user_status.active] ?? 0,
      suspended: byStatus[user_status.suspended] ?? 0,
    };
  }

  @Get('customers')
  async customers(@Query() query: ListCustomersDto) {
    const where = {
      role: user_role.CUSTOMER,
      deleted_at: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q.trim(), mode: 'insensitive' as const } },
              { phone: { contains: query.q.trim() } },
              {
                user_profiles: {
                  full_name: { contains: query.q.trim(), mode: 'insensitive' as const },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.users.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        include: { user_profiles: true, _count: { select: { bookings: true } } },
      }),
      this.prisma.users.count({ where }),
    ]);

    // Lifetime spend, for this page of customers only. Summing it in the same
    // query as the rows is not something Prisma's `_count` can do, and summing
    // it for every customer in the table would be a lot of work to show fifteen
    // numbers.
    const spendRows = rows.length
      ? await this.prisma.bookings.groupBy({
          by: ['customer_id'],
          where: {
            customer_id: { in: rows.map((u) => u.user_id) },
            deleted_at: null,
            status: { in: REVENUE_STATUSES },
          },
          _sum: { total_amount: true },
        })
      : [];
    const spentBy = new Map(
      spendRows.map((r) => [r.customer_id.toString(), r._sum.total_amount ?? 0n]),
    );

    return paged(
      rows.map((u) => ({
        id: u.user_id.toString(),
        email: u.email,
        phone: u.phone,
        fullName: u.user_profiles?.full_name ?? null,
        tier: u.user_profiles?.tier ?? 'silver',
        points: u.user_profiles?.points ?? 0,
        status: u.status,
        isVerified: u.is_verified,
        bookings: u._count.bookings,
        spent: kipOf(spentBy.get(u.user_id.toString()) ?? 0n),
        createdAt: u.created_at,
      })),
      total,
      query,
    );
  }

  @Patch('customers/:id/status')
  @Audit('customer_status_change', 'admin', 'users')
  async setCustomerStatus(@Param('id') id: string, @Body() dto: SetUserStatusDto) {
    const updated = await this.prisma.users.update({
      where: { user_id: BigInt(id) },
      data: { status: dto.status },
      select: { user_id: true, email: true, status: true },
    });
    // Suspending someone should also end their sessions, or they stay signed in
    // until the access token expires.
    if (dto.status === user_status.suspended) {
      await this.prisma.user_sessions.updateMany({
        where: { user_id: BigInt(id), revoked_at: null },
        data: { revoked_at: new Date() },
      });
    }
    return { id: updated.user_id.toString(), email: updated.email, status: updated.status };
  }

  /** Counts for the filter tabs, so switching tabs does not re-count. */
  @Get('bookings/status-counts')
  async bookingStatusCounts() {
    const rows = await this.prisma.bookings.groupBy({
      by: ['status'],
      where: { deleted_at: null },
      _count: true,
    });
    const counts = Object.fromEntries(rows.map((r) => [r.status, r._count]));
    return { ...counts, all: rows.reduce((sum, r) => sum + r._count, 0) };
  }

  @Get('bookings')
  async adminBookings(@Query() query: ListBookingsAdminDto) {
    const where = {
      deleted_at: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? { booking_code: { contains: query.q.trim(), mode: 'insensitive' as const } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.bookings.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        include: {
          properties: { select: { property_name: true } },
          users: { include: { user_profiles: { select: { full_name: true } } } },
          payments: { select: { status: true }, orderBy: { created_at: 'desc' }, take: 1 },
        },
      }),
      this.prisma.bookings.count({ where }),
    ]);

    return paged(
      rows.map((b) => ({
        id: b.booking_id.toString(),
        code: b.booking_code,
        property: b.properties.property_name,
        guest: b.users.user_profiles?.full_name ?? '—',
        checkIn: b.check_in,
        checkOut: b.check_out,
        nights: b.nights,
        total: kipOf(b.total_amount),
        commission: kipOf(b.commission_amount),
        status: b.status,
        source: b.source,
        paymentStatus: b.payments[0]?.status ?? null,
        createdAt: b.created_at,
      })),
      total,
      query,
    );
  }

  @Get('bookings/:id')
  bookingDetail(@Param('id') id: string) {
    return this.bookings.findOne(BigInt(id));
  }

  /** Cancelling moves money, so finance and above only. */
  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @AdminRoles(...MONEY_ROLES)
  @Audit('booking_cancel', 'admin', 'bookings')
  cancelBooking(
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.bookings.cancel(BigInt(id), dto.reason, { id: user.userId, role: user.role });
  }

  // ── payouts ───────────────────────────────────────────────────────────────

  @Get('payouts')
  @AdminRoles(...MONEY_ROLES)
  listPayouts(@Query('status') status?: payout_status) {
    return this.payouts.list(status);
  }

  @Get('payouts/:id/items')
  @AdminRoles(...MONEY_ROLES)
  payoutItems(@Param('id') id: string) {
    return this.payouts.items(BigInt(id));
  }

  /**
   * A batch run that reports counts, not a resource creation — it may well
   * create nothing, because a period already paid out is skipped. 200 with the
   * summary, matching `pay-all` below.
   */
  @Post('payouts/generate')
  @HttpCode(200)
  @AdminRoles(...MONEY_ROLES)
  @Audit('payout_generate', 'finance', 'payouts')
  generate(@Body() dto: GeneratePayoutDto) {
    return this.payouts.generate(dto.periodStart);
  }

  @Patch('payouts/:id/pay')
  @AdminRoles(...MONEY_ROLES)
  @Audit('payout_pay', 'finance', 'payouts')
  pay(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.payouts.pay(BigInt(id), user.userId);
  }

  @Post('payouts/pay-all')
  @HttpCode(200)
  @AdminRoles(...MONEY_ROLES)
  @Audit('payout_pay_all', 'finance', 'payouts')
  payAll(@CurrentUser() user: AuthedUser) {
    return this.payouts.payAll(user.userId);
  }

  // ── reviews moderation ────────────────────────────────────────────────────

  @Get('reviews/counts')
  async reviewCounts() {
    const [rows, average] = await Promise.all([
      this.prisma.reviews.groupBy({ by: ['status'], _count: true }),
      this.prisma.reviews.aggregate({ _avg: { overall_rating: true } }),
    ]);
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r._count]));

    return {
      total: rows.reduce((sum, r) => sum + r._count, 0),
      published: byStatus.published ?? 0,
      hidden: byStatus.hidden ?? 0,
      flagged: byStatus.flagged ?? 0,
      pending: byStatus.pending ?? 0,
      averageStars: average._avg.overall_rating
        ? Math.round(rateOf(average._avg.overall_rating) * 10) / 10
        : null,
    };
  }

  @Get('reviews')
  async reviews(@Query() query: ListReviewsDto) {
    const term = query.q?.trim();
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(term
        ? {
            OR: [
              { comment: { contains: term, mode: 'insensitive' as const } },
              { title: { contains: term, mode: 'insensitive' as const } },
              {
                properties: {
                  property_name: { contains: term, mode: 'insensitive' as const },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.reviews.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        include: {
          properties: { select: { property_name: true } },
          users: { include: { user_profiles: { select: { full_name: true } } } },
          _count: { select: { review_reports: true } },
        },
      }),
      this.prisma.reviews.count({ where }),
    ]);

    return paged(
      rows.map((r) => ({
        id: r.review_id.toString(),
        stars: rateOf(r.overall_rating),
        title: r.title,
        comment: r.comment,
        property: r.properties.property_name,
        guest: r.users.user_profiles?.full_name ?? '—',
        status: r.status,
        reports: r._count.review_reports,
        createdAt: r.created_at,
      })),
      total,
      query,
    );
  }

  /**
   * Hiding a review takes it out of the property's score — the
   * `t_reviews_recalc_rating` trigger recomputes `rating_avg` from published
   * rows, so nothing here has to remember to do it.
   */
  @Patch('reviews/:id/hide')
  @Audit('review_hide', 'admin', 'reviews')
  async hideReview(@Param('id') id: string) {
    const r = await this.prisma.reviews.update({
      where: { review_id: BigInt(id) },
      data: { status: 'hidden' },
    });
    return { id: r.review_id.toString(), status: r.status };
  }

  @Patch('reviews/:id/publish')
  @Audit('review_publish', 'admin', 'reviews')
  async publishReview(@Param('id') id: string) {
    const r = await this.prisma.reviews.update({
      where: { review_id: BigInt(id) },
      data: { status: 'published' },
    });
    return { id: r.review_id.toString(), status: r.status };
  }

  // ── settings & audit ──────────────────────────────────────────────────────

  @Get('settings')
  async getSettings() {
    const [system, app] = await Promise.all([
      this.settings.get(),
      this.settings.appSettings(),
    ]);
    return { system, app };
  }

  /**
   * Rates and money levers — finance and above.
   *
   * Returns the same `{ system, app }` shape as the GET, so the client can
   * replace its state with the response instead of guessing what took effect.
   */
  @Patch('settings')
  @AdminRoles(...MONEY_ROLES)
  @Audit('settings_update', 'admin', 'system_settings')
  async updateSettings(@Body() dto: UpdateSettingsDto, @CurrentUser() user: AuthedUser) {
    const { app: appPatch, ...systemPatch } = dto;
    const [system, app] = await Promise.all([
      this.settings.update(systemPatch, user.userId),
      appPatch
        ? this.settings.updateAppSettings(appPatch, user.userId)
        : this.settings.appSettings(),
    ]);
    return { system, app };
  }

  /**
   * Adds a member of staff.
   *
   * Deliberately not open registration — there is no public path to an ADMIN
   * row anywhere in the API. Only an existing super_admin can make another
   * administrator, and the audit log records who did.
   */
  @Post('admins')
  @AdminRoles(admin_role.super_admin)
  @Audit('admin_create', 'admin', 'users')
  async createAdmin(@Body() dto: CreateAdminDto) {
    const email = dto.email.trim().toLowerCase();

    const clash = await this.prisma.users.findUnique({ where: { email } });
    if (clash) {
      throw new ConflictException(`ອີເມວ ${email} ຖືກໃຊ້ແລ້ວ · That email is already registered`);
    }

    const created = await this.prisma.users.create({
      data: {
        role: user_role.ADMIN,
        admin_role: dto.adminRole,
        email,
        password_hash: await this.passwords.hash(dto.password),
        // Staff are vouched for by the super_admin who added them; there is no
        // inbox to send a verification code to.
        is_verified: true,
        user_profiles: { create: { full_name: dto.fullName.trim() } },
      },
      include: { user_profiles: { select: { full_name: true } } },
    });

    return {
      id: created.user_id.toString(),
      email: created.email,
      fullName: created.user_profiles?.full_name ?? null,
      adminRole: created.admin_role,
      status: created.status,
    };
  }

  /**
   * Removes a member of staff. Soft delete plus session revocation: the audit
   * log still points at a row, but the account cannot be signed into again.
   */
  @Delete('admins/:id')
  @AdminRoles(admin_role.super_admin)
  @Audit('admin_delete', 'admin', 'users')
  async deleteAdmin(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    const targetId = BigInt(id);
    if (targetId === user.userId) {
      throw new ForbiddenException('ລຶບບັນຊີຕົນເອງບໍ່ໄດ້ · You cannot remove your own account');
    }

    const target = await this.prisma.users.findFirst({
      where: { user_id: targetId, role: user_role.ADMIN, deleted_at: null },
      select: { admin_role: true },
    });
    if (!target) throw new BadRequestException(`ບໍ່ພົບຜູ້ດູແລ #${id} · Admin not found`);

    // The same guard as demotion: the platform must keep at least one account
    // that can add the next one.
    if (target.admin_role === admin_role.super_admin) {
      const supers = await this.prisma.users.count({
        where: { role: user_role.ADMIN, admin_role: admin_role.super_admin, deleted_at: null },
      });
      if (supers <= 1) {
        throw new ForbiddenException(
          'ຕ້ອງເຫຼືອ super_admin ຢ່າງໜ້ອຍ 1 ຄົນ · At least one super_admin must remain',
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.users.update({
        where: { user_id: targetId },
        data: { deleted_at: new Date(), status: user_status.deleted },
      }),
      this.prisma.user_sessions.updateMany({
        where: { user_id: targetId, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    ]);

    return { id: id, deleted: true };
  }

  @Get('admins')
  @AdminRoles(admin_role.super_admin)
  async admins() {
    const rows = await this.prisma.users.findMany({
      where: { role: user_role.ADMIN, deleted_at: null },
      orderBy: { user_id: 'asc' },
      include: { user_profiles: { select: { full_name: true } } },
    });
    return rows.map((a) => ({
      id: a.user_id.toString(),
      email: a.email,
      fullName: a.user_profiles?.full_name ?? null,
      adminRole: a.admin_role,
      lastLoginAt: a.last_login_at,
      status: a.status,
    }));
  }

  @Patch('admins/:id/role')
  @AdminRoles(admin_role.super_admin)
  @Audit('admin_role_change', 'admin', 'users')
  async setAdminRole(
    @Param('id') id: string,
    @Body('adminRole') role: admin_role,
    @CurrentUser() user: AuthedUser,
  ) {
    const targetId = BigInt(id);

    // Demoting yourself could leave the platform with no super_admin at all.
    if (targetId === user.userId && role !== admin_role.super_admin) {
      throw new ForbiddenException(
        'ປ່ຽນສິດຕົນເອງລົງບໍ່ໄດ້ · You cannot remove your own super_admin role',
      );
    }

    const target = await this.prisma.users.findUnique({
      where: { user_id: targetId },
      select: { admin_role: true },
    });
    if (target?.admin_role === admin_role.super_admin && role !== admin_role.super_admin) {
      const supers = await this.prisma.users.count({
        where: { role: user_role.ADMIN, admin_role: admin_role.super_admin, deleted_at: null },
      });
      if (supers <= 1) {
        throw new ForbiddenException(
          'ຕ້ອງມີ super_admin ຢ່າງໜ້ອຍ 1 ຄົນ · At least one super_admin must remain',
        );
      }
    }

    const updated = await this.prisma.users.update({
      where: { user_id: targetId },
      data: { admin_role: role },
      select: { user_id: true, email: true, admin_role: true },
    });
    return {
      id: updated.user_id.toString(),
      email: updated.email,
      adminRole: updated.admin_role,
    };
  }

  @Get('audit-logs')
  async auditLogs(@Query() query: AuditQueryDto) {
    const where = query.action ? { action: query.action } : {};
    const [rows, total] = await Promise.all([
      this.prisma.audit_logs.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        include: {
          users: {
            select: { email: true, user_profiles: { select: { full_name: true } } },
          },
        },
      }),
      this.prisma.audit_logs.count({ where }),
    ]);

    return paged(
      rows.map((l) => ({
        id: l.audit_log_id.toString(),
        action: l.action,
        module: l.module_name,
        table: l.table_name,
        recordId: l.record_id?.toString() ?? null,
        // Null actor is the system: the hold sweeper, the payout generator.
        actor: l.users?.user_profiles?.full_name ?? l.users?.email ?? 'ລະບົບ',
        ip: l.ip_address,
        createdAt: l.created_at,
      })),
      total,
      query,
    );
  }
}
