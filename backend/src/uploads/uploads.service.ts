import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALLOWED_IMAGE_FORMATS,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_PROPERTY,
  STORAGE_TOKEN,
  type StorageProvider,
} from './storage.interface';

const FORMAT_TO_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

type ImageFormat = (typeof ALLOWED_IMAGE_FORMATS)[number];

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_TOKEN) private readonly storage: StorageProvider,
  ) {}

  async list(propertyId: bigint) {
    const rows = await this.prisma.property_images.findMany({
      where: { property_id: propertyId },
      orderBy: [{ is_cover: 'desc' }, { display_order: 'asc' }],
    });
    return rows.map(toDto);
  }

  /**
   * Ownership is checked by the controller (OwnershipService) before this
   * runs — the same split every partner route uses.
   */
  async addPropertyPhoto(propertyId: bigint, file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException('ກະລຸນາເລືອກຮູບ · No file was uploaded');
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new BadRequestException('ຮູບໃຫຍ່ເກີນໄປ ສູງສຸດ 5MB · File too large — 5MB maximum');
    }

    const existing = await this.prisma.property_images.count({
      where: { property_id: propertyId },
    });
    if (existing >= MAX_PHOTOS_PER_PROPERTY) {
      throw new BadRequestException(
        `ຮູບເຕັມແລ້ວ ສູງສຸດ ${MAX_PHOTOS_PER_PROPERTY} ຮູບຕໍ່ທີ່ພັກ · Maximum ${MAX_PHOTOS_PER_PROPERTY} photos per property`,
      );
    }

    await detectFormat(file.buffer); // validates the upload is a real, allowed image
    const rotated = await sharp(file.buffer).rotate().toBuffer(); // shared EXIF-corrected source for both sizes
    const [full, thumb] = await Promise.all([optimizePhoto(rotated), thumbnailPhoto(rotated)]);

    const id = randomUUID();
    const [url, thumbnailUrl] = await Promise.all([
      this.storage.save(`properties/${propertyId}/${id}.webp`, full, FORMAT_TO_MIME.webp),
      this.storage.save(`properties/${propertyId}/${id}_thumb.webp`, thumb, FORMAT_TO_MIME.webp),
    ]);

    const row = await this.prisma.property_images.create({
      data: {
        property_id: propertyId,
        image_url: url,
        thumbnail_url: thumbnailUrl,
        display_order: existing,
        is_cover: existing === 0,
      },
    });
    return toDto(row);
  }

  async removePropertyPhoto(propertyId: bigint, photoId: bigint) {
    const { count } = await this.prisma.property_images.deleteMany({
      where: { property_image_id: photoId, property_id: propertyId },
    });
    if (!count) {
      throw new NotFoundException(`ບໍ່ພົບຮູບ #${photoId} · Photo not found`);
    }
    return { removed: true };
  }

  /**
   * Applies a full front-to-back order for this property's photos in one
   * go — the first id in the list becomes the cover (`is_cover`), the rest
   * get sequential `display_order`. Matches the Airbnb-style convention
   * partners already expect: drag your best photo to the front and it's
   * the cover, no separate "set as cover" action to teach.
   *
   * `photoIds` must be exactly this property's photo ids, one each — that's
   * verified against the DB rather than trusted from the client, both so a
   * partner can't smuggle in another property's photo id (cross-tenant
   * write) and so a dropped id doesn't silently strand a photo at a stale
   * position instead of failing loudly.
   */
  async reorderPhotos(propertyId: bigint, photoIds: bigint[]) {
    if (new Set(photoIds).size !== photoIds.length) {
      throw new BadRequestException('ມີຮູບຊ້ຳໃນລາຍການ · Duplicate photo in the list');
    }

    const existing = await this.prisma.property_images.findMany({
      where: { property_id: propertyId },
      select: { property_image_id: true },
    });
    const existingIds = new Set(existing.map((row) => row.property_image_id));
    const matches =
      photoIds.length === existing.length && photoIds.every((id) => existingIds.has(id));
    if (!matches) {
      throw new BadRequestException(
        'ລາຍການຮູບບໍ່ຕົງກັບຮູບຂອງທີ່ພັກນີ້ · Photo list does not match this property\'s photos',
      );
    }

    await this.prisma.$transaction(
      photoIds.map((photoId, index) =>
        this.prisma.property_images.update({
          where: { property_image_id: photoId },
          data: { display_order: index, is_cover: index === 0 },
        }),
      ),
    );
    return this.list(propertyId);
  }

  /**
   * Admin-curated photo for the Home "Explore regions" rail — overrides the
   * auto-derived one CatalogService.provinces() otherwise falls back to.
   * One photo, not a gallery: a region tile has room for exactly one.
   */
  async setProvincePhoto(provinceId: bigint, file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException('ກະລຸນາເລືອກຮູບ · No file was uploaded');
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new BadRequestException('ຮູບໃຫຍ່ເກີນໄປ ສູງສຸດ 5MB · File too large — 5MB maximum');
    }

    await detectFormat(file.buffer);
    const rotated = await sharp(file.buffer).rotate().toBuffer();
    const thumb = await thumbnailPhoto(rotated);

    const url = await this.storage.save(
      `provinces/${provinceId}/${randomUUID()}.webp`,
      thumb,
      FORMAT_TO_MIME.webp,
    );

    const { count } = await this.prisma.provinces.updateMany({
      where: { province_id: provinceId },
      data: { image_url: url },
    });
    if (!count) throw new NotFoundException(`ບໍ່ພົບແຂວງ #${provinceId} · Province not found`);
    return { imageUrl: url };
  }

  /** Back to the auto-derived cover photo. */
  async clearProvincePhoto(provinceId: bigint) {
    const { count } = await this.prisma.provinces.updateMany({
      where: { province_id: provinceId },
      data: { image_url: null },
    });
    if (!count) throw new NotFoundException(`ບໍ່ພົບແຂວງ #${provinceId} · Province not found`);
    return { cleared: true };
  }
}

/**
 * Reads the format out of the file's own header via sharp, rather than
 * trusting the multipart Content-Type the client declared — a renamed
 * script with a ".jpg" name fails to decode and is rejected here.
 */
async function detectFormat(buffer: Buffer): Promise<ImageFormat> {
  let format: string | undefined;
  try {
    ({ format } = await sharp(buffer).metadata());
  } catch {
    throw new BadRequestException('ໄຟລ໌ບໍ່ແມ່ນຮູບພາບທີ່ຖືກຕ້ອງ · File is not a valid image');
  }
  if (!isAllowedFormat(format)) {
    throw new BadRequestException(
      'ຮັບແຕ່ໄຟລ໌ JPEG, PNG, WebP · Only JPEG, PNG and WebP are accepted',
    );
  }
  return format;
}

function isAllowedFormat(format: string | undefined): format is ImageFormat {
  return !!format && (ALLOWED_IMAGE_FORMATS as readonly string[]).includes(format);
}

/**
 * Property photos come straight off phone cameras (up to 5MB, easily
 * 4000px+ wide) but are only ever displayed at card/gallery sizes. Re-encode
 * to webp, capped at 1920px on the long edge, so the detail/lightbox view
 * isn't downloading the original.
 */
async function optimizePhoto(rotated: Buffer): Promise<Buffer> {
  return sharp(rotated)
    .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
}

/**
 * A second, small copy for property cards and gallery grids — those never
 * render anywhere near full width, so shipping the 1920px version there was
 * pure wasted bandwidth.
 */
async function thumbnailPhoto(rotated: Buffer): Promise<Buffer> {
  return sharp(rotated)
    .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
}

function toDto(row: {
  property_image_id: bigint;
  image_url: string;
  thumbnail_url: string | null;
  caption: string | null;
  is_cover: boolean;
  display_order: number;
}) {
  return {
    id: row.property_image_id.toString(),
    url: row.image_url,
    // Older rows uploaded before thumbnails existed fall back to the full image.
    thumbnailUrl: row.thumbnail_url ?? row.image_url,
    caption: row.caption,
    isCover: row.is_cover,
    displayOrder: row.display_order,
  };
}
