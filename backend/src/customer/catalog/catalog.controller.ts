import { Controller, Get, HttpCode, Param, Post, Query, Body } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators';
import { findUsablePromo } from '../../common/booking-pricing';
import { promoDiscount } from '../../common/money';
import { SearchDto, StayRangeDto, CalendarQueryDto, ValidatePromoDto } from './catalog.dto';

/**
 * The public catalogue. Browsing needs no account — a guest has to see prices
 * before deciding to register — so every route here is @Public().
 */
@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('properties')
  search(@Query() query: SearchDto) {
    return this.catalog.search(query);
  }

  @Public()
  @Get('properties/provinces')
  provinces() {
    return this.catalog.provinces();
  }

  @Public()
  @Get('properties/:id')
  findOne(@Param('id') id: string, @Query() query: StayRangeDto) {
    return this.catalog.findOne(BigInt(id), query.checkIn, query.checkOut);
  }

  @Public()
  @Get('properties/:id/calendar')
  calendar(@Param('id') id: string, @Query() query: CalendarQueryDto) {
    return this.catalog.roomCalendar(BigInt(id), query.from, query.to);
  }

  /**
   * Checks a promo code before the guest commits to a booking. Returns what it
   * would take off, using the same rules the booking transaction applies — so
   * the number shown at checkout is the number charged.
   */
  @Public()
  @HttpCode(200)
  @Post('promos/validate')
  async validatePromo(@Body() dto: ValidatePromoDto) {
    const promo = await findUsablePromo(this.prisma, dto.code);
    const subtotal = dto.subtotal ?? 0;

    return {
      code: promo.code,
      type: promo.type,
      value: promo.value,
      expiresAt: promo.expires_at,
      discount: subtotal ? promoDiscount(promo.type, promo.value, subtotal) : null,
    };
  }
}
