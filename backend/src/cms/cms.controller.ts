import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { banner_target_type, target_user_type, user_role } from '@prisma/client';
import { CmsService } from './cms.service';
import { Audit, CurrentUser, Public, Roles, type AuthedUser } from '../common/decorators';

class HomeQueryDto {
  @IsOptional()
  @IsEnum(target_user_type)
  audience?: target_user_type;
}

class BannerDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @IsOptional() @IsEnum(banner_target_type) targetType?: banner_target_type;
  @IsOptional() @IsString() targetId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) displayOrder?: number;
  @IsOptional() @IsISO8601() startDate?: string;
  @IsOptional() @IsISO8601() endDate?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class AnnouncementDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsEnum(target_user_type) audience?: target_user_type;
  @IsOptional() @IsISO8601() startDate?: string;
  @IsOptional() @IsISO8601() endDate?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class FaqDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() @MaxLength(80) category?: string;
  @IsString() @MinLength(3) question!: string;
  @IsString() @MinLength(3) answer!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) displayOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class PageDto {
  /** Lowercase, hyphenated — it appears in URLs and in `user_agreements`. */
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,118}$/, {
    message: 'slug ຕ້ອງເປັນຕົວພິມນ້ອຍ ຕົວເລກ ແລະ ຂີດກາງ · lowercase, digits and hyphens only',
  })
  slug!: string;

  @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/**
 * What the apps read.
 *
 * All public: a home screen and a terms page are the first things a visitor
 * sees, and neither should need an account.
 */
@Controller('content')
export class PublicCmsController {
  constructor(private readonly cms: CmsService) {}

  @Public()
  @Get('home')
  home(@Query() query: HomeQueryDto) {
    return this.cms.home(query.audience);
  }

  @Public()
  @Get('faqs')
  faqs() {
    return this.cms.faqs();
  }

  @Public()
  @Get('pages')
  pages() {
    return this.cms.pageIndex();
  }

  @Public()
  @Get('pages/:slug')
  page(@Param('slug') slug: string) {
    return this.cms.page(slug);
  }
}

/**
 * Editing it.
 *
 * Any admin role may write copy — this is not a money lever, and blocking a
 * staff member from fixing a typo in an FAQ helps nobody.
 */
@Controller('admin/content')
@Roles(user_role.ADMIN)
export class AdminCmsController {
  constructor(private readonly cms: CmsService) {}

  @Get('banners')
  banners() {
    return this.cms.allBanners();
  }

  @Post('banners')
  @Audit('cms_banner_save', 'admin', 'banners')
  saveBanner(@CurrentUser() user: AuthedUser, @Body() dto: BannerDto) {
    return this.cms.saveBanner(user.userId, {
      ...dto,
      id: dto.id ? BigInt(dto.id) : undefined,
    });
  }

  @Delete('banners/:id')
  @Audit('cms_banner_delete', 'admin', 'banners')
  removeBanner(@Param('id') id: string) {
    return this.cms.removeBanner(BigInt(id));
  }

  @Get('announcements')
  announcements() {
    return this.cms.allAnnouncements();
  }

  @Post('announcements')
  @Audit('cms_announcement_save', 'admin', 'announcements')
  saveAnnouncement(@CurrentUser() user: AuthedUser, @Body() dto: AnnouncementDto) {
    return this.cms.saveAnnouncement(user.userId, {
      ...dto,
      id: dto.id ? BigInt(dto.id) : undefined,
    });
  }

  @Delete('announcements/:id')
  @Audit('cms_announcement_delete', 'admin', 'announcements')
  removeAnnouncement(@Param('id') id: string) {
    return this.cms.removeAnnouncement(BigInt(id));
  }

  @Get('faqs')
  faqs() {
    return this.cms.allFaqs();
  }

  @Post('faqs')
  @Audit('cms_faq_save', 'admin', 'faqs')
  saveFaq(@CurrentUser() user: AuthedUser, @Body() dto: FaqDto) {
    return this.cms.saveFaq(user.userId, { ...dto, id: dto.id ? BigInt(dto.id) : undefined });
  }

  @Delete('faqs/:id')
  @Audit('cms_faq_delete', 'admin', 'faqs')
  removeFaq(@Param('id') id: string) {
    return this.cms.removeFaq(BigInt(id));
  }

  @Get('pages')
  pages() {
    return this.cms.allPages();
  }

  /**
   * Upsert by slug. There is no delete: a page referenced by name from three
   * clients and from `user_agreements` should be deactivated, not removed.
   */
  @Post('pages')
  @Audit('cms_page_save', 'admin', 'app_pages')
  savePage(@CurrentUser() user: AuthedUser, @Body() dto: PageDto) {
    return this.cms.savePage(user.userId, dto);
  }
}
