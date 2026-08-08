import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Platform configuration, read from `system_settings`.
 *
 * v1 kept these in `app_settings` as jsonb. v2 splits them: `system_settings`
 * holds the technical knobs this service reads (rates, TTLs, limits), and
 * `app_settings` holds user-facing text the CMS edits. They are different
 * audiences with different edit rights, so they are different tables.
 *
 * Values are stored as text with a `data_type` saying how to read them. The
 * defaults below are the contract: if a row is missing or unparseable the
 * platform still works, and the fallback is logged rather than silently used.
 */
export interface PlatformSettings {
  /** % taken from an in-app booking. */
  commission_rate_app: number;
  /** % taken from a walk-in the partner recorded. */
  commission_rate_walkin: number;
  /** % added to the room subtotal and shown to the guest. */
  service_fee_rate: number;
  tax_rate: number;
  /** How long a `pending` booking holds inventory before it is swept. */
  hold_ttl_minutes: number;
  max_nights_per_booking: number;
  default_min_nights: number;
  payment_provider: string;
  qr_ttl_minutes: number;
  payout_period_days: number;
  otp_ttl_minutes: number;
  otp_max_attempts: number;
  password_reset_ttl_minutes: number;
  login_max_attempts: number;
  login_lockout_minutes: number;
  access_token_ttl: string;
  refresh_token_ttl: string;
  max_image_mb: number;
  max_images_per_property: number;
}

const DEFAULTS: PlatformSettings = {
  commission_rate_app: 5,
  commission_rate_walkin: 2.5,
  service_fee_rate: 5,
  tax_rate: 0,
  hold_ttl_minutes: 15,
  max_nights_per_booking: 60,
  default_min_nights: 1,
  payment_provider: 'simulated',
  qr_ttl_minutes: 15,
  payout_period_days: 7,
  otp_ttl_minutes: 5,
  otp_max_attempts: 5,
  password_reset_ttl_minutes: 30,
  login_max_attempts: 5,
  login_lockout_minutes: 15,
  access_token_ttl: '15m',
  refresh_token_ttl: '7d',
  max_image_mb: 5,
  max_images_per_property: 12,
};

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cache: PlatformSettings | null = null;
  private cachedAt = 0;

  /**
   * Short enough that an edit on the Settings screen takes effect almost at
   * once, long enough that pricing a booking does not hit the database for
   * every night.
   */
  private static readonly TTL_MS = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<PlatformSettings> {
    if (this.cache && Date.now() - this.cachedAt < SettingsService.TTL_MS) {
      return this.cache;
    }

    const rows = await this.prisma.system_settings.findMany({
      select: { setting_key: true, setting_value: true },
    });
    const merged = { ...DEFAULTS };

    for (const row of rows) {
      if (!(row.setting_key in merged)) continue;
      const key = row.setting_key as keyof PlatformSettings;
      const raw = row.setting_value;
      if (raw === null) continue;

      if (typeof merged[key] === 'number') {
        const n = Number(raw);
        if (Number.isFinite(n)) {
          (merged[key] as number) = n;
        } else {
          this.logger.warn(`system_settings.${row.setting_key} = "${raw}" is not a number; using ${merged[key]}`);
        }
      } else {
        (merged[key] as string) = raw;
      }
    }

    this.cache = merged;
    this.cachedAt = Date.now();
    return merged;
  }

  /** Called after a write so the next read sees the new value immediately. */
  invalidate(): void {
    this.cache = null;
    this.cachedAt = 0;
  }

  /**
   * Upserts the given keys. Only keys already known to `PlatformSettings` are
   * written, so a typo in a request body cannot create a setting nothing reads.
   */
  async update(patch: Partial<PlatformSettings>, adminUserId: bigint): Promise<PlatformSettings> {
    const entries = Object.entries(patch).filter(([k]) => k in DEFAULTS);
    if (!entries.length) return this.get();

    await this.prisma.$transaction(
      entries.map(([key, value]) =>
        this.prisma.system_settings.upsert({
          where: { setting_key: key },
          create: {
            setting_key: key,
            setting_value: String(value),
            data_type: typeof value === 'number' ? 'int' : 'string',
            updated_by: adminUserId,
          },
          update: {
            setting_value: String(value),
            updated_by: adminUserId,
            updated_at: new Date(),
          },
        }),
      ),
    );

    this.invalidate();
    return this.get();
  }

  /** User-facing text (platform name, contact details) from `app_settings`. */
  async appSettings(): Promise<Record<string, string>> {
    const rows = await this.prisma.app_settings.findMany({
      select: { setting_key: true, setting_value: true },
    });
    return Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value ?? '']));
  }

  /**
   * Updates the user-facing strings.
   *
   * Only keys that already exist are written. These are read by name all over
   * the apps, so letting the admin console invent new ones would fill the table
   * with values nothing ever reads — and quietly hide a typo in an existing key.
   */
  async updateAppSettings(
    patch: Record<string, string>,
    adminUserId: bigint,
  ): Promise<Record<string, string>> {
    const known = await this.prisma.app_settings.findMany({ select: { setting_key: true } });
    const allowed = new Set(known.map((r) => r.setting_key));
    const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
    if (!entries.length) return this.appSettings();

    await this.prisma.$transaction(
      entries.map(([setting_key, setting_value]) =>
        this.prisma.app_settings.update({
          where: { setting_key },
          data: { setting_value, updated_by: adminUserId, updated_at: new Date() },
        }),
      ),
    );

    return this.appSettings();
  }
}
