import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { user_role } from '@prisma/client';
import { UploadsService } from './uploads.service';
import { OwnershipService } from '../partner/ownership.service';
import { Audit, CurrentUser, Roles, type AuthedUser } from '../common/decorators';
import { MAX_PHOTO_BYTES } from './storage.interface';
import { ReorderPhotosDto } from './uploads.dto';

/**
 * Property photos for the partner app.
 *
 * The exact size/type limit is enforced in UploadsService, where a bilingual
 * message can be given; multer's own limit here is only a generous safety
 * net so an oversized upload doesn't sit in memory unbounded.
 */
@Controller('partner/properties/:id/photos')
@Roles(user_role.PARTNER)
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly own: OwnershipService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    const partnerId = this.own.partnerId(user);
    await this.own.assertOwnsProperty(partnerId, BigInt(id));
    return this.uploads.list(BigInt(id));
  }

  @Post()
  @HttpCode(201)
  @Audit('partner_property_photo_add', 'partner', 'property_images')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_BYTES * 2 },
    }),
  )
  async upload(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const partnerId = this.own.partnerId(user);
    await this.own.assertOwnsProperty(partnerId, BigInt(id));
    return this.uploads.addPropertyPhoto(BigInt(id), file);
  }

  @Patch('order')
  @Audit('partner_property_photo_reorder', 'partner', 'property_images')
  async reorder(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: ReorderPhotosDto,
  ) {
    const partnerId = this.own.partnerId(user);
    await this.own.assertOwnsProperty(partnerId, BigInt(id));
    return this.uploads.reorderPhotos(BigInt(id), dto.photoIds.map(BigInt));
  }

  @Delete(':photoId')
  @Audit('partner_property_photo_remove', 'partner', 'property_images')
  async remove(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ) {
    const partnerId = this.own.partnerId(user);
    await this.own.assertOwnsProperty(partnerId, BigInt(id));
    return this.uploads.removePropertyPhoto(BigInt(id), BigInt(photoId));
  }
}

/** Generic image upload for admin content — banners, etc. */
@Controller('admin/uploads')
@Roles(user_role.ADMIN)
export class AdminUploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('image')
  @HttpCode(201)
  @Audit('admin_image_upload', 'admin', 'uploads')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_BYTES * 2 },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.uploads.uploadAdminImage(file);
  }
}

/**
 * The one photo shown for a province on Home's "Explore regions" rail —
 * see UploadsService.setProvincePhoto for what it overrides.
 */
@Controller('admin/locations/provinces/:id/photo')
@Roles(user_role.ADMIN)
export class AdminProvincePhotoController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @Audit('admin_province_photo_set', 'admin', 'provinces')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_BYTES * 2 },
    }),
  )
  async upload(@Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.uploads.setProvincePhoto(BigInt(id), file);
  }

  @Delete()
  @Audit('admin_province_photo_clear', 'admin', 'provinces')
  async clear(@Param('id') id: string) {
    return this.uploads.clearProvincePhoto(BigInt(id));
  }
}
