import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { user_role } from '@prisma/client';
import { PartnerService } from './partner.service';
import { OwnershipService } from './ownership.service';
import { BookingService } from '../booking/booking.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Audit, CurrentUser, Roles, type AuthedUser } from '../common/decorators';
import { rateOf } from '../common/money';
import {
  BankAccountDto,
  DateRangeDto,
  RoomTypeDto,
  SetInventoryDto,
  SetPriceDto,
  UpdatePartnerProfileDto,
  UpdatePropertyDto,
  UpdateRoomTypeDto,
} from './partner.dto';
import {
  CancelBookingDto,
  ListBookingsDto,
  SetBookingStatusDto,
  WalkInDto,
} from '../booking/booking.dto';

@Controller('partner')
@Roles(user_role.PARTNER)
export class PartnerController {
  constructor(
    private readonly partner: PartnerService,
    private readonly bookings: BookingService,
    private readonly own: OwnershipService,
    private readonly prisma: PrismaService,
    // `notifications_` because `notifications` is already a route handler here.
    private readonly notifications_: NotificationsService,
  ) {}

  // ── profile ───────────────────────────────────────────────────────────────

  @Get('me')
  async me(@CurrentUser() user: AuthedUser) {
    const partnerId = this.own.partnerId(user);
    const row = await this.prisma.partners.findUniqueOrThrow({
      where: { partner_id: partnerId },
      include: {
        users: { include: { user_profiles: true } },
        partner_bank_accounts: { where: { status: 'active' } },
        _count: { select: { properties: true } },
      },
    });

    return {
      id: row.partner_id.toString(),
      businessName: row.business_name,
      businessType: row.business_type,
      taxId: row.tax_id,
      contactPhone: row.contact_phone,
      status: row.status,
      verifiedAt: row.verified_at,
      commissionRate: rateOf(row.default_commission_rate),
      walkinCommissionRate: rateOf(row.walkin_commission_rate),
      ownerName: row.users.user_profiles?.full_name ?? null,
      email: row.users.email,
      propertyCount: row._count.properties,
      bankAccounts: row.partner_bank_accounts.map((b) => ({
        id: b.bank_account_id.toString(),
        bankName: b.bank_name,
        accountName: b.account_name,
        // Only the last digits ever leave the server.
        account: `***${b.account_number.slice(-4)}`,
        isDefault: b.is_default,
      })),
    };
  }

  @Patch('me')
  @Audit('partner_profile_update', 'partner', 'partners')
  async updateMe(@CurrentUser() user: AuthedUser, @Body() dto: UpdatePartnerProfileDto) {
    const partnerId = this.own.partnerId(user);
    await this.prisma.partners.update({
      where: { partner_id: partnerId },
      data: {
        ...(dto.businessName !== undefined && { business_name: dto.businessName }),
        ...(dto.contactPhone !== undefined && { contact_phone: dto.contactPhone }),
        ...(dto.taxId !== undefined && { tax_id: dto.taxId }),
      },
    });
    return this.me(user);
  }

  @Post('bank-accounts')
  @Audit('partner_bank_account_add', 'partner', 'partner_bank_accounts')
  async addBankAccount(@CurrentUser() user: AuthedUser, @Body() dto: BankAccountDto) {
    const partnerId = this.own.partnerId(user);
    const existing = await this.prisma.partner_bank_accounts.count({
      where: { partner_id: partnerId, status: 'active' },
    });

    await this.prisma.partner_bank_accounts.create({
      data: {
        partner_id: partnerId,
        bank_name: dto.bankName,
        account_name: dto.accountName,
        // Stored as given; encrypting at rest is a deployment concern and is
        // flagged in the schema rather than faked here.
        account_number: dto.accountNumber,
        is_default: existing === 0,
      },
    });
    return this.me(user);
  }

  // ── properties & room types ───────────────────────────────────────────────

  @Get('properties')
  properties(@CurrentUser() user: AuthedUser) {
    return this.partner.properties(this.own.partnerId(user));
  }

  @Patch('properties/:id')
  @Audit('partner_property_update', 'partner', 'properties')
  updateProperty(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.partner.updateProperty(this.own.partnerId(user), BigInt(id), dto);
  }

  @Post('properties/:id/room-types')
  @Audit('partner_room_type_create', 'partner', 'room_types')
  createRoomType(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: RoomTypeDto,
  ) {
    return this.partner.createRoomType(this.own.partnerId(user), BigInt(id), dto);
  }

  @Patch('room-types/:roomTypeId')
  @Audit('partner_room_type_update', 'partner', 'room_types', 'roomTypeId')
  updateRoomType(
    @CurrentUser() user: AuthedUser,
    @Param('roomTypeId') roomTypeId: string,
    @Body() dto: UpdateRoomTypeDto,
  ) {
    return this.partner.updateRoomType(this.own.partnerId(user), BigInt(roomTypeId), dto);
  }

  @Delete('room-types/:roomTypeId')
  @Audit('partner_room_type_delete', 'partner', 'room_types', 'roomTypeId')
  removeRoomType(@CurrentUser() user: AuthedUser, @Param('roomTypeId') roomTypeId: string) {
    return this.partner.removeRoomType(this.own.partnerId(user), BigInt(roomTypeId));
  }

  // ── inventory & prices ────────────────────────────────────────────────────

  @Get('room-types/:roomTypeId/calendar')
  calendar(
    @CurrentUser() user: AuthedUser,
    @Param('roomTypeId') roomTypeId: string,
    @Query() query: DateRangeDto,
  ) {
    return this.partner.calendar(
      this.own.partnerId(user),
      BigInt(roomTypeId),
      query.from,
      query.to,
    );
  }

  /** Opens or closes nights, and sets how many rooms are on sale. */
  @Patch('room-types/:roomTypeId/inventory')
  @Audit('partner_inventory_update', 'partner', 'room_inventory', 'roomTypeId')
  setInventory(
    @CurrentUser() user: AuthedUser,
    @Param('roomTypeId') roomTypeId: string,
    @Body() dto: SetInventoryDto,
  ) {
    return this.partner.setInventory(this.own.partnerId(user), BigInt(roomTypeId), dto);
  }

  @Patch('room-types/:roomTypeId/prices')
  @Audit('partner_price_update', 'partner', 'room_prices', 'roomTypeId')
  setPrice(
    @CurrentUser() user: AuthedUser,
    @Param('roomTypeId') roomTypeId: string,
    @Body() dto: SetPriceDto,
  ) {
    return this.partner.setPrice(this.own.partnerId(user), BigInt(roomTypeId), dto);
  }

  // ── bookings ──────────────────────────────────────────────────────────────

  @Get('bookings')
  list(@CurrentUser() user: AuthedUser, @Query() query: ListBookingsDto) {
    return this.partner.bookings(this.own.partnerId(user), {
      skip: query.skip,
      limit: query.limit,
      page: query.page,
      status: query.status,
      q: query.q,
    });
  }

  @Get('bookings/status-counts')
  statusCounts(@CurrentUser() user: AuthedUser) {
    return this.partner.statusCounts(this.own.partnerId(user));
  }

  @Get('bookings/:id')
  async findOne(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    const partnerId = this.own.partnerId(user);
    await this.own.assertOwnsBooking(partnerId, BigInt(id));
    return this.bookings.findOne(BigInt(id));
  }

  @Patch('bookings/:id/status')
  @Audit('partner_booking_status', 'partner', 'bookings')
  async setStatus(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: SetBookingStatusDto,
  ) {
    const partnerId = this.own.partnerId(user);
    await this.own.assertOwnsBooking(partnerId, BigInt(id));
    return this.bookings.setStatus(BigInt(id), dto.status, user.userId);
  }

  /** Records a guest who booked at the desk — `source = walk_in`. */
  @Post('bookings/walk-in')
  @Audit('partner_walkin_create', 'partner', 'bookings')
  async walkIn(@CurrentUser() user: AuthedUser, @Body() dto: WalkInDto) {
    const partnerId = this.own.partnerId(user);
    await this.own.assertVerified(partnerId);
    return this.bookings.createWalkIn(partnerId, dto);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @Audit('partner_booking_cancel', 'partner', 'bookings')
  async cancel(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
  ) {
    const partnerId = this.own.partnerId(user);
    await this.own.assertOwnsBooking(partnerId, BigInt(id));
    return this.bookings.cancel(BigInt(id), dto.reason, { id: user.userId, role: user.role });
  }

  // ── money & dashboard ─────────────────────────────────────────────────────

  @Get('payouts')
  payouts(@CurrentUser() user: AuthedUser) {
    return this.partner.payouts(this.own.partnerId(user));
  }

  @Get('payouts/:id/items')
  payoutItems(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.partner.payoutItems(this.own.partnerId(user), BigInt(id));
  }

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthedUser) {
    return this.partner.dashboard(this.own.partnerId(user), user.userId);
  }

  @Get('reviews')
  async reviews(@CurrentUser() user: AuthedUser) {
    const propertyIds = await this.own.propertyIds(this.own.partnerId(user));
    if (!propertyIds.length) return { items: [], total: 0, averageStars: null };

    const [rows, agg] = await Promise.all([
      this.prisma.reviews.findMany({
        where: { property_id: { in: propertyIds }, status: 'published' },
        orderBy: { created_at: 'desc' },
        take: 100,
        include: {
          properties: { select: { property_name: true } },
          users: { include: { user_profiles: { select: { full_name: true } } } },
        },
      }),
      this.prisma.reviews.aggregate({
        where: { property_id: { in: propertyIds }, status: 'published' },
        _avg: { overall_rating: true },
        _count: true,
      }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.review_id.toString(),
        stars: rateOf(r.overall_rating),
        title: r.title,
        comment: r.comment,
        property: r.properties.property_name,
        guest: r.users.user_profiles?.full_name ?? '—',
        createdAt: r.created_at,
      })),
      total: agg._count,
      averageStars: agg._avg.overall_rating
        ? Number(agg._avg.overall_rating.toFixed(2))
        : null,
    };
  }

  @Get('notifications')
  notifications(@CurrentUser() user: AuthedUser) {
    return this.notifications_.feed(user.userId);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthedUser) {
    return this.notifications_.markAllRead(user.userId);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  markRead(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.notifications_.markRead(user.userId, BigInt(id));
  }
}
