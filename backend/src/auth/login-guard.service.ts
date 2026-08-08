import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../common/settings.service';

/**
 * Brute-force protection, backed by `login_attempts`.
 *
 * The throttler already caps requests per IP, but that does nothing against a
 * slow spread across many IPs aimed at one account. This counts failures per
 * *identifier* — the email someone is trying — inside a rolling window, and
 * locks that account out once the count is reached.
 *
 * Every attempt is recorded, successful or not: the table is also the evidence
 * when someone asks who has been trying to get in.
 */
@Injectable()
export class LoginGuardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Throws 429 when the identifier is locked out. Call before checking a password. */
  async assertNotLocked(identifier: string): Promise<void> {
    const { login_max_attempts, login_lockout_minutes } = await this.settings.get();
    const since = new Date(Date.now() - login_lockout_minutes * 60_000);

    const failures = await this.prisma.login_attempts.count({
      where: { identifier: identifier.toLowerCase(), success: false, created_at: { gte: since } },
    });

    if (failures >= login_max_attempts) {
      throw new HttpException(
        `ລອງເຂົ້າລະບົບຜິດຫຼາຍເທື່ອເກີນໄປ ກະລຸນາລໍ ${login_lockout_minutes} ນາທີ · ` +
          `Too many failed attempts, try again in ${login_lockout_minutes} minutes`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Records the outcome. Never throws — a failure to write the log must not
   * turn a valid sign-in into an error.
   */
  async record(
    identifier: string,
    success: boolean,
    ip: string,
    userAgent: string | null,
  ): Promise<void> {
    await this.prisma.login_attempts
      .create({
        data: {
          identifier: identifier.toLowerCase().slice(0, 255),
          success,
          ip_address: ip.slice(0, 64),
          user_agent: userAgent,
        },
      })
      .catch(() => undefined);
  }

  /**
   * Clears the failure history after a successful sign-in, so a user who
   * mistyped four times and then got it right starts fresh rather than being
   * one typo away from a lockout.
   */
  async clearFailures(identifier: string): Promise<void> {
    await this.prisma.login_attempts
      .deleteMany({ where: { identifier: identifier.toLowerCase(), success: false } })
      .catch(() => undefined);
  }
}
