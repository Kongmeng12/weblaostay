import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ConfigService } from '@nestjs/config';
import { StorageProvider } from './storage.interface';

/**
 * S3-compatible object storage — Cloudflare R2, AWS S3, MinIO.
 *
 * Constructed only when STORAGE_PROVIDER=r2 (see uploads.module.ts), so a
 * missing key here stops the process at boot rather than falling back to
 * local disk and silently misbehaving once traffic arrives.
 */
export class R2StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(config: ConfigService) {
    const endpoint = required(config, 'S3_ENDPOINT');
    const region = config.get<string>('S3_REGION', 'auto');
    this.bucket = required(config, 'S3_BUCKET');
    const accessKeyId = required(config, 'S3_ACCESS_KEY_ID');
    const secretAccessKey = required(config, 'S3_SECRET_ACCESS_KEY');
    this.publicUrl = required(config, 'S3_PUBLIC_URL').replace(/\/+$/, '');

    this.client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async save(key: string, buffer: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return `${this.publicUrl}/${key}`;
  }
}

function required(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value) {
    throw new Error(
      `STORAGE_PROVIDER=r2 requires ${key} — set it in .env or switch back to STORAGE_PROVIDER=local`,
    );
  }
  return value;
}
