import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { UPLOAD_ROOT, UPLOAD_URL_PREFIX } from './storage.interface';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 8 * 1024 * 1024;

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly provider: string;
  private s3?: S3Client;
  private bucket?: string;
  private publicUrl?: string;

  constructor(private readonly config: ConfigService) {
    this.provider = (config.get<string>('STORAGE_PROVIDER') ?? 'local').toLowerCase();
  }

  onModuleInit() {
    if (this.provider !== 'r2') return;

    const endpoint = this.config.get<string>('S3_ENDPOINT');
    const region = this.config.get<string>('S3_REGION', 'auto');
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY');
    this.bucket = this.config.get<string>('S3_BUCKET');
    this.publicUrl = this.config.get<string>('S3_PUBLIC_URL');

    if (!endpoint || !accessKeyId || !secretAccessKey || !this.bucket || !this.publicUrl) {
      this.logger.error('STORAGE_PROVIDER=r2 requires S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_PUBLIC_URL');
      throw new Error('Missing S3 configuration for r2 storage provider');
    }

    this.s3 = new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey } });
    this.logger.log(`Storage: r2 → ${this.bucket}`);
  }

  async save(file: Express.Multer.File): Promise<string> {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        'ຮູບຕ້ອງເປັນ JPEG, PNG, WebP ຫຼື GIF · Only JPEG, PNG, WebP or GIF allowed',
      );
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('ຮູບໃຫຍ່ເກີນ 8 MB · Image must be under 8 MB');
    }

    const ext = extname(file.originalname).toLowerCase() || '.jpg';
    const name = `${randomUUID()}${ext}`;

    if (this.provider === 'r2') {
      return this.saveToS3(file, name);
    }
    return this.saveToLocal(file, name);
  }

  private async saveToLocal(file: Express.Multer.File, name: string): Promise<string> {
    await writeFile(join(UPLOAD_ROOT, name), file.buffer);
    return `${UPLOAD_URL_PREFIX}/${name}`;
  }

  private async saveToS3(file: Express.Multer.File, name: string): Promise<string> {
    await this.s3!.send(
      new PutObjectCommand({
        Bucket: this.bucket!,
        Key: name,
        Body: file.buffer,
        ContentType: file.mimetype,
        CacheControl: 'public, max-age=2592000',
      }),
    );
    return `${this.publicUrl!.replace(/\/$/, '')}/${name}`;
  }
}
