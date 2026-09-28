import { Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { StorageProvider, UPLOAD_ROOT, UPLOAD_URL_PREFIX } from './storage.interface';

/**
 * Writes photos to this machine's disk. Fine for one instance with a
 * persistent volume; a redeploy that recreates the container, or a second
 * instance behind a load balancer, loses them silently — that's why the
 * warning fires once at construction rather than staying quiet.
 */
export class LocalStorageProvider implements StorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);

  constructor() {
    this.logger.warn(
      'STORAGE_PROVIDER=local: photos are written to local disk. Not safe for ' +
        'multiple instances or ephemeral disks — set STORAGE_PROVIDER=r2 before that.',
    );
  }

  async save(key: string, buffer: Buffer): Promise<string> {
    const path = join(UPLOAD_ROOT, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
    return `${UPLOAD_URL_PREFIX}/${key}`;
  }
}
