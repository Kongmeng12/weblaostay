import { join } from 'node:path';

/**
 * Local disk location for uploaded photos, and the URL path they are served
 * at when STORAGE_PROVIDER=local. main.ts mounts UPLOAD_ROOT as static
 * assets under UPLOAD_URL_PREFIX — both are needed there, so they live here
 * rather than inside a provider class.
 */
export const UPLOAD_ROOT = join(process.cwd(), 'uploads');
export const UPLOAD_URL_PREFIX = '/uploads';

/** DI token — the concrete provider (local disk or R2) is chosen at boot from STORAGE_PROVIDER. */
export const STORAGE_TOKEN = Symbol('STORAGE_PROVIDER');

export interface StorageProvider {
  /** Writes the bytes under `key` and returns the public URL to store in the DB. */
  save(key: string, buffer: Buffer, contentType: string): Promise<string>;
}

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS_PER_PROPERTY = 12;

// Decoded by sharp from the file's own bytes, not the client's declared
// mimetype — see UploadsService.
export const ALLOWED_IMAGE_FORMATS = ['jpeg', 'png', 'webp'] as const;
