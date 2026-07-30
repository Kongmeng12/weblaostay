import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PlatformSettings {
  platform_name: string;
  contact_email: string;
  /** % taken from an in-app booking. */
  commission_rate: number;
  /** % taken from a walk-in booking recorded by the partner. */
  walkin_commission_rate: number;
  /** % kept when a customer cancels. */
  cancellation_fee_rate: number;
}

const DEFAULTS: PlatformSettings = {
  platform_name: 'LaoStay · ພັກເຮືອນລາວ',
  contact_email: 'support@laostay.la',
  commission_rate: 5,
  walkin_commission_rate: 2.5,
  cancellation_fee_rate: 30,
};

/**
 * Reads platform config from `app_settings`.
 *
 * Money maths runs on every dashboard load and every payout row, so the values
 * are cached briefly. The TTL is short enough that a rate change on the
 * Settings screen takes effect almost immediately, and `invalidate()` makes it
 * instant for the process that made the change.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cache: PlatformSettings | null = null;
  private cachedAt = 0;
  private static readonly TTL_MS = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<PlatformSettings> {
    if (this.cache && Date.now() - this.cachedAt < SettingsService.TTL_MS) {
      return this.cache;
    }

    const rows = await this.prisma.app_settings.findMany();
    const merged = { ...DEFAULTS };

    for (const row of rows) {
      if (!(row.key in merged)) continue;
      const key = row.key as keyof PlatformSettings;
      const value = row.value as unknown;

      if (typeof merged[key] === 'number') {
        const n = typeof value === 'number' ? value : Number(value);
        if (Number.isFinite(n)) (merged[key] as number) = n;
        else this.logger.warn(`app_settings.${row.key} is not a number, using default`);
      } else if (typeof value === 'string') {
        (merged[key] as string) = value;
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

  async update(patch: Partial<PlatformSettings>, adminId: bigint): Promise<PlatformSettings> {
    const entries = Object.entries(patch).filter(([k]) => k in DEFAULTS);

    await this.prisma.$transaction(
      entries.map(([key, value]) =>
        this.prisma.app_settings.upsert({
          where: { key },
          create: { key, value: value as never, updated_by: adminId },
          update: { value: value as never, updated_at: new Date(), updated_by: adminId },
        }),
      ),
    );

    this.invalidate();
    return this.get();
  }
}
