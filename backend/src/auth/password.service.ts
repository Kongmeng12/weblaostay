import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcrypt';

/**
 * Password hashing, and the migration between two algorithms.
 *
 * New passwords are argon2id — it is the stronger choice and what OWASP
 * recommends. But the database was seeded from SQL, where the only hash
 * available is pgcrypto's bcrypt, so existing rows carry `$2a$`/`$2b$` hashes.
 *
 * Rather than force a password reset on everyone, `verify()` accepts either and
 * reports whether the stored hash is stale. The caller re-hashes with argon2 on
 * the next successful sign-in, so the bcrypt rows drain away by themselves.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  /** Sized for a login (a handful per user per day), not a bulk endpoint. */
  private static readonly ARGON_OPTS: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19_456, // 19 MiB — OWASP minimum
    timeCost: 2,
    parallelism: 1,
  };

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, PasswordService.ARGON_OPTS);
  }

  /**
   * @returns `ok` — whether the password matched.
   *          `needsRehash` — true when it matched a bcrypt hash, so the caller
   *          should replace it with argon2.
   */
  async verify(plain: string, storedHash: string): Promise<{ ok: boolean; needsRehash: boolean }> {
    if (isBcrypt(storedHash)) {
      const ok = await bcrypt.compare(plain, storedHash).catch(() => false);
      return { ok, needsRehash: ok };
    }

    const ok = await argon2.verify(storedHash, plain).catch(() => false);
    return { ok, needsRehash: false };
  }

  /**
   * Burns roughly the same time as a real verify, for the branch where no
   * account matched. Without it, the response time says whether an email
   * exists — which is all an attacker needs to enumerate accounts.
   */
  async wasteTime(plain: string): Promise<void> {
    await argon2.hash(plain, PasswordService.ARGON_OPTS).catch(() => undefined);
  }

  /** Fire-and-forget upgrade; a failure here must not fail the sign-in. */
  async upgradeInBackground(
    userId: bigint,
    plain: string,
    save: (userId: bigint, hash: string) => Promise<unknown>,
  ): Promise<void> {
    try {
      const fresh = await this.hash(plain);
      await save(userId, fresh);
      this.logger.log(`Upgraded password hash for user ${userId} from bcrypt to argon2id`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Password rehash for user ${userId} failed: ${message}`);
    }
  }
}

/** bcrypt hashes start `$2a$`, `$2b$` or `$2y$`; argon2 starts `$argon2`. */
function isBcrypt(hash: string): boolean {
  return /^\$2[aby]?\$/.test(hash);
}
