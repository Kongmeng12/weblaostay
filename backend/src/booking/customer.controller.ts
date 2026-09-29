import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { booking_status, user_role } from '@prisma/client';
import { BookingService } from './booking.service';
import { BookingDocumentsService, type DownloadableFile } from './documents/booking-documents.service';
import { CheckinQrService, CHECK_IN_QR_STATUSES } from './checkin-qr.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CurrentUser, Roles, type AuthedUser } from '../common/decorators';
import { paged } from '../common/dto/pagination.dto';
import { kipOf, rateOf } from '../common/money';
import {
  CancelBookingDto,
  CreateBookingDto,
  CreateReviewDto,
  ListBookingsDto,
} from './booking.dto';

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

@Controller('customer')
@Roles(user_role.CUSTOMER)
export class CustomerController {
  constructor(
    private readonly bookings: BookingService,
    private readonly documents: BookingDocumentsService,
    private readonly checkinQr: CheckinQrService,
    private readonly prisma: PrismaService,
    // `notifications_` because `notifications` is already a route handler here.
    private readonly notifications_: NotificationsService,
  ) {}

  // ── bookings ──────────────────────────────────────────────────────────────

  /** Prices a stay before committing to it. Writes nothing. */
  @HttpCode(200)
  @Post('bookings/quote')
  quote(@Body() dto: CreateBookingDto) {
    return this.bookings.quote(dto);
  }

  @Post('bookings')
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreateBookingDto) {
    return this.bookings.create(user.userId, dto);
  }

  @Get('bookings')
  async list(@CurrentUser() user: AuthedUser, @Query() query: ListBookingsDto) {
    const where = {
      customer_id: user.userId,
      deleted_at: null,
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.bookings.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        include: {
          properties: {
            select: {
              property_id: true,
              property_name: true,
              provinces: { select: { province_name_lo: true } },
              property_images: {
                select: { image_url: true },
                orderBy: [{ is_cover: 'desc' }, { display_order: 'asc' }],
                take: 1,
              },
            },
          },
          booking_items: { include: { room_types: { select: { type_name: true } } } },
          payments: { select: { payment_id: true, status: true }, orderBy: { created_at: 'desc' } },
          reviews: { select: { review_id: true } },
        },
      }),
      this.prisma.bookings.count({ where }),
    ]);

    return paged(
      rows.map((b) => ({
        id: b.booking_id.toString(),
        code: b.booking_code,
        propertyId: b.properties.property_id.toString(),
        property: b.properties.property_name,
        province: b.properties.provinces?.province_name_lo ?? null,
        photo:
          b.properties.property_images[0]?.image_url ?? null,
        roomType: b.booking_items[0]?.room_types.type_name ?? null,
        checkIn: b.check_in,
        checkOut: b.check_out,
        nights: b.nights,
        guests: b.total_guests,
        total: kipOf(b.total_amount),
        status: b.status,
        holdExpiresAt: b.hold_expires_at,
        paymentId: b.payments[0]?.payment_id.toString() ?? null,
        paymentStatus: b.payments[0]?.status ?? null,
        reviewed: b.reviews !== null,
      })),
      total,
      query,
    );
  }

  @Get('bookings/:id')
  async findOne(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    const booking = await this.bookings.findOne(BigInt(id), user.userId);
    return {
      ...booking,
      // The signed check-in QR — only while there is a check-in still to do.
      checkInQr: CHECK_IN_QR_STATUSES.has(booking.status) ? this.checkinQr.urlFor(booking.id) : null,
    };
  }

  /** Booking confirmation + payment receipt, PDF/A-2b. Paid or cancelled bookings only. */
  @Get('bookings/:id/confirmation')
  @Header('Cache-Control', 'private, no-store')
  async confirmation(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return asDownload(await this.documents.confirmationPdf(BigInt(id), user.userId));
  }

  /** The stay as an iCalendar (RFC 5545) event. Confirmed or in-progress stays only. */
  @Get('bookings/:id/calendar')
  @Header('Cache-Control', 'private, no-store')
  async calendar(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return asDownload(await this.documents.calendarIcs(BigInt(id), user.userId));
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
  ) {
    const bookingId = BigInt(id);
    // Ownership check first: findOne is scoped to this user and 404s otherwise.
    await this.bookings.findOne(bookingId, user.userId);
    return this.bookings.cancel(bookingId, dto.reason, { id: user.userId, role: user.role });
  }

  // ── reviews ───────────────────────────────────────────────────────────────

  /**
   * One review per completed stay. The property's score is **not** recalculated
   * here — the `t_reviews_recalc_rating` trigger does it, so a review written
   * by any path keeps `rating_avg` honest.
   */
  @Post('bookings/:id/review')
  async review(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: CreateReviewDto,
  ) {
    const bookingId = BigInt(id);

    const booking = await this.prisma.bookings.findFirst({
      where: { booking_id: bookingId, customer_id: user.userId },
      include: { reviews: { select: { review_id: true } } },
    });

    if (!booking) throw new NotFoundException(`ບໍ່ພົບການຈອງ #${bookingId} · Booking not found`);
    if (booking.status !== booking_status.completed) {
      throw new BadRequestException(
        'ຂຽນຮີວິວໄດ້ຫຼັງພັກຈົບແລ້ວ · You can review a stay once it is complete',
      );
    }
    if (booking.reviews) {
      throw new ConflictException('ຮີວິວການຈອງນີ້ແລ້ວ · You have already reviewed this stay');
    }

    const review = await this.prisma.reviews.create({
      data: {
        booking_id: bookingId,
        customer_id: user.userId,
        property_id: booking.property_id,
        overall_rating: dto.stars,
        cleanliness_rating: dto.cleanliness ?? null,
        service_rating: dto.service ?? null,
        value_rating: dto.value ?? null,
        title: dto.title ?? null,
        comment: dto.comment ?? null,
      },
    });

    const property = await this.prisma.properties.findUniqueOrThrow({
      where: { property_id: booking.property_id },
      select: { rating_avg: true, review_count: true, partners: { select: { user_id: true } } },
    });

    // The host hears about it and can answer — or ask an admin to hide it —
    // from their Reviews screen. Swallowed on failure: the review is written.
    await this.notifications_.send(null, {
      userId: property.partners.user_id,
      templateCode: 'review_received',
      vars: { booking_code: booking.booking_code, stars: dto.stars },
      referenceType: 'review',
      referenceId: review.review_id,
    });

    return {
      id: review.review_id.toString(),
      stars: rateOf(review.overall_rating),
      propertyRating: rateOf(property.rating_avg),
      propertyReviewCount: property.review_count,
    };
  }

  // ── profile and wishlist ──────────────────────────────────────────────────

  @Get('me')
  async me(@CurrentUser() user: AuthedUser) {
    const row = await this.prisma.users.findUniqueOrThrow({
      where: { user_id: user.userId },
      include: { user_profiles: true },
    });

    const counts = await this.prisma.bookings.groupBy({
      by: ['status'],
      where: { customer_id: user.userId, deleted_at: null },
      _count: true,
    });
    const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));

    return {
      id: row.user_id.toString(),
      email: row.email,
      phone: row.phone,
      fullName: row.user_profiles?.full_name ?? null,
      avatarUrl: row.user_profiles?.avatar_url ?? null,
      tier: row.user_profiles?.tier ?? 'silver',
      points: row.user_profiles?.points ?? 0,
      isVerified: row.is_verified,
      bookings: {
        total: counts.reduce((sum, c) => sum + c._count, 0),
        upcoming: (byStatus[booking_status.pending] ?? 0) + (byStatus[booking_status.confirmed] ?? 0),
        completed: byStatus[booking_status.completed] ?? 0,
      },
    };
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: AuthedUser, @Body() dto: UpdateProfileDto) {
    if (dto.phone !== undefined) {
      await this.prisma.users.update({
        where: { user_id: user.userId },
        data: { phone: dto.phone },
      });
    }
    if (dto.fullName !== undefined) {
      await this.prisma.user_profiles.upsert({
        where: { user_id: user.userId },
        create: { user_id: user.userId, full_name: dto.fullName },
        update: { full_name: dto.fullName },
      });
    }
    return this.me(user);
  }

  @Get('wishlist')
  async wishlist(@CurrentUser() user: AuthedUser) {
    const rows = await this.prisma.wishlist_items.findMany({
      where: { user_id: user.userId },
      orderBy: { created_at: 'desc' },
      include: {
        properties: {
          select: {
            property_id: true,
            property_name: true,
            property_type: true,
            rating_avg: true,
            review_count: true,
            provinces: { select: { province_name_lo: true } },
            property_images: {
              select: { image_url: true },
              orderBy: [{ is_cover: 'desc' }, { display_order: 'asc' }],
              take: 1,
            },
            room_types: {
              where: { status: 'active', deleted_at: null },
              orderBy: { base_price: 'asc' },
              take: 1,
              select: { base_price: true },
            },
          },
        },
      },
    });

    return rows.map((w) => ({
      propertyId: w.properties.property_id.toString(),
      name: w.properties.property_name,
      type: w.properties.property_type,
      province: w.properties.provinces?.province_name_lo ?? null,
      rating: rateOf(w.properties.rating_avg),
      reviewCount: w.properties.review_count,
      photo:
        w.properties.property_images[0]?.image_url ?? null,
      fromPricePerNight: w.properties.room_types[0]
        ? kipOf(w.properties.room_types[0].base_price)
        : null,
    }));
  }

  @Post('wishlist/:propertyId')
  @HttpCode(201)
  async addToWishlist(@CurrentUser() user: AuthedUser, @Param('propertyId') propertyId: string) {
    const id = BigInt(propertyId);

    const property = await this.prisma.properties.findFirst({
      where: { property_id: id, deleted_at: null, partners: { status: 'verified' } },
      select: { property_id: true },
    });
    if (!property) throw new NotFoundException(`ບໍ່ພົບທີ່ພັກ #${id} · Property not found`);

    const existing = await this.prisma.wishlist_items.findFirst({
      where: { user_id: user.userId, property_id: id },
    });
    if (existing) throw new ConflictException('ຢູ່ໃນລາຍການທີ່ມັກແລ້ວ · Already in your wishlist');

    const created = await this.prisma.wishlist_items.create({
      data: { user_id: user.userId, property_id: id },
    });
    return { id: created.wishlist_item_id.toString(), propertyId: propertyId };
  }

  @Post('wishlist/:propertyId/remove')
  @HttpCode(200)
  async removeFromWishlist(
    @CurrentUser() user: AuthedUser,
    @Param('propertyId') propertyId: string,
  ) {
    const { count } = await this.prisma.wishlist_items.deleteMany({
      where: { user_id: user.userId, property_id: BigInt(propertyId) },
    });
    return { removed: count };
  }

  // ── notifications ─────────────────────────────────────────────────────────

  // A notification does not know which kind of account it belongs to, so both
  // this controller and the partner's delegate to the same service rather than
  // keeping two copies of the same query.

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

/**
 * A file the browser or app should save, not render inline. The filename is
 * ASCII by construction (BookingDocumentsService keeps it to [A-Za-z0-9-]), so
 * the plain RFC 6266 `filename=` form needs no encoding.
 */
function asDownload(file: DownloadableFile): StreamableFile {
  return new StreamableFile(file.body, {
    type: file.contentType,
    disposition: `attachment; filename="${file.filename}"`,
    length: file.body.length,
  });
}
