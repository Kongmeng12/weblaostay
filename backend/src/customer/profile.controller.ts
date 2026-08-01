import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { Actor, CurrentUser, type AuthedUser } from '../common/decorators';
import { ACTOR } from '../common/actors';
import { BOOKING_STATUS, PARTNER_STATUS } from '../common/money';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(50)
  phone?: string;
}

/** Profile and wishlist — the guest's own corner of the app. */
@Controller('customer')
@Actor(ACTOR.USER)
export class CustomerProfileController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthedUser) {
    const [row, counts] = await Promise.all([
      this.prisma.users.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          full_name: true,
          phone: true,
          tier: true,
          points: true,
          status: true,
          is_verified: true,
          created_at: true,
        },
      }),
      this.prisma.bookings.groupBy({
        by: ['status'],
        where: { user_id: user.id },
        _count: true,
      }),
    ]);

    const byStatus = Object.fromEntries(counts.map((c) => [c.status ?? 'unknown', c._count]));

    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      phone: row.phone,
      tier: row.tier,
      points: row.points,
      status: row.status,
      isVerified: row.is_verified,
      createdAt: row.created_at,
      bookings: {
        total: counts.reduce((sum, c) => sum + c._count, 0),
        upcoming:
          (byStatus[BOOKING_STATUS.PENDING] ?? 0) + (byStatus[BOOKING_STATUS.CONFIRMED] ?? 0),
        completed: byStatus[BOOKING_STATUS.DONE] ?? 0,
      },
    };
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: AuthedUser, @Body() dto: UpdateProfileDto) {
    const row = await this.prisma.users.update({
      where: { id: user.id },
      data: {
        ...(dto.fullName !== undefined && { full_name: dto.fullName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
      },
      select: { id: true, email: true, full_name: true, phone: true },
    });
    return { id: row.id, email: row.email, fullName: row.full_name, phone: row.phone };
  }

  // ── wishlist ──────────────────────────────────────────────────────────────

  @Get('wishlist')
  async wishlist(@CurrentUser() user: AuthedUser) {
    const rows = await this.prisma.wishlists.findMany({
      where: { user_id: user.id },
      orderBy: { id: 'desc' },
      include: {
        properties: {
          select: {
            id: true,
            name: true,
            type: true,
            province: true,
            rating: true,
            review_count: true,
            photos: true,
            rooms: {
              where: { is_active: true },
              orderBy: { base_price: 'asc' },
              take: 1,
              select: { base_price: true },
            },
          },
        },
      },
    });

    return rows.map((w) => ({
      id: w.id,
      propertyId: w.properties.id,
      name: w.properties.name,
      type: w.properties.type,
      province: w.properties.province,
      rating: w.properties.rating,
      reviewCount: w.properties.review_count ?? 0,
      photos: w.properties.photos ?? [],
      fromPricePerNight: w.properties.rooms[0]?.base_price ?? null,
    }));
  }

  @Post('wishlist/:propertyId')
  @HttpCode(201)
  async addToWishlist(
    @CurrentUser() user: AuthedUser,
    @Param('propertyId') propertyId: string,
  ) {
    const id = BigInt(propertyId);

    const property = await this.prisma.properties.findFirst({
      where: { id, partners: { status: PARTNER_STATUS.VERIFIED } },
      select: { id: true },
    });
    if (!property) throw new NotFoundException(`ບໍ່ພົບທີ່ພັກ #${id} · Property not found`);

    const existing = await this.prisma.wishlists.findFirst({
      where: { user_id: user.id, property_id: id },
    });
    if (existing) {
      throw new ConflictException('ຢູ່ໃນລາຍການທີ່ມັກແລ້ວ · Already in your wishlist');
    }

    return this.prisma.wishlists.create({ data: { user_id: user.id, property_id: id } });
  }

  @Delete('wishlist/:propertyId')
  async removeFromWishlist(
    @CurrentUser() user: AuthedUser,
    @Param('propertyId') propertyId: string,
  ) {
    const { count } = await this.prisma.wishlists.deleteMany({
      where: { user_id: user.id, property_id: BigInt(propertyId) },
    });
    return { removed: count };
  }
}
