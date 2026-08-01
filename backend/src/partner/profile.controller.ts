import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { OwnershipService } from './ownership.service';
import { Actor, Audit, CurrentPartner, type AuthedPartner } from '../common/decorators';
import { ACTOR } from '../common/actors';
import { PAYOUT_STATUS } from '../common/money';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  ownerName?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankAccount?: string;
}

class PayoutQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

/**
 * Profile, payouts and reviews — the read-mostly corners of the partner app.
 *
 * Payouts are deliberately read-only here: money leaves the platform only when
 * someone with the finance role presses the button in the WebAdmin.
 */
@Controller('partner')
@Actor(ACTOR.PARTNER)
export class PartnerProfileController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly own: OwnershipService,
  ) {}

  @Get('me')
  async me(@CurrentPartner() partner: AuthedPartner) {
    const row = await this.prisma.partners.findUniqueOrThrow({
      where: { id: partner.id },
      include: { _count: { select: { properties: true } } },
    });

    return {
      id: row.id,
      email: row.email,
      ownerName: row.owner_name,
      phone: row.phone,
      status: row.status,
      bankName: row.bank_name,
      // Only the last four digits ever leave the server.
      bankAccount: row.bank_account ? `***${row.bank_account.slice(-4)}` : null,
      commissionRate: row.commission_rate,
      propertyCount: row._count.properties,
      createdAt: row.created_at,
    };
  }

  @Patch('me')
  @Audit('partner_profile_update')
  async updateMe(@CurrentPartner() partner: AuthedPartner, @Body() dto: UpdateProfileDto) {
    const row = await this.prisma.partners.update({
      where: { id: partner.id },
      data: {
        ...(dto.ownerName !== undefined && { owner_name: dto.ownerName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.bankName !== undefined && { bank_name: dto.bankName }),
        ...(dto.bankAccount !== undefined && { bank_account: dto.bankAccount }),
      },
      select: { id: true, owner_name: true, phone: true, bank_name: true, bank_account: true },
    });

    return {
      id: row.id,
      ownerName: row.owner_name,
      phone: row.phone,
      bankName: row.bank_name,
      bankAccount: row.bank_account ? `***${row.bank_account.slice(-4)}` : null,
    };
  }

  @Get('payouts')
  async payouts(@CurrentPartner() partner: AuthedPartner, @Query() query: PayoutQueryDto) {
    const rows = await this.prisma.payouts.findMany({
      where: { partner_id: partner.id },
      orderBy: { period_start: 'desc' },
      take: query.limit,
    });

    const pending = rows.filter((p) => p.status === PAYOUT_STATUS.PENDING);

    return {
      items: rows.map((p) => ({
        id: p.id,
        periodStart: p.period_start,
        periodEnd: p.period_end,
        gmv: p.gmv,
        commission: p.commission,
        netAmount: p.net_amount,
        status: p.status,
        paidAt: p.paid_at,
      })),
      pendingCount: pending.length,
      pendingTotal: pending.reduce((sum, p) => sum + p.net_amount, 0),
      paidTotal: rows
        .filter((p) => p.status === PAYOUT_STATUS.PAID)
        .reduce((sum, p) => sum + p.net_amount, 0),
    };
  }

  /** Reviews of this partner's properties. Hidden ones are not shown. */
  @Get('reviews')
  async reviews(@CurrentPartner() partner: AuthedPartner) {
    const propertyIds = await this.own.propertyIds(partner.id);
    if (!propertyIds.length) return { items: [], total: 0, averageStars: null };

    const [rows, avg] = await Promise.all([
      this.prisma.reviews.findMany({
        where: { property_id: { in: propertyIds }, is_hidden: false },
        orderBy: { id: 'desc' },
        take: 100,
        include: {
          properties: { select: { id: true, name: true } },
          bookings: { select: { id: true, users: { select: { full_name: true } } } },
        },
      }),
      this.prisma.reviews.aggregate({
        where: { property_id: { in: propertyIds }, is_hidden: false },
        _avg: { stars: true },
        _count: true,
      }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        stars: r.stars,
        text: r.text,
        propertyId: r.properties.id,
        property: r.properties.name,
        guest: r.bookings.users.full_name,
        bookingId: r.booking_id,
      })),
      total: avg._count,
      averageStars: avg._avg.stars ? Number(avg._avg.stars.toFixed(2)) : null,
    };
  }
}
