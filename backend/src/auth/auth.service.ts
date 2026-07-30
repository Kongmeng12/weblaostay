import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterAdminDto } from './dto/auth.dto';
import { ROLE, isRole, type Role } from '../common/roles';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface AuthResult extends TokenPair {
  admin: { id: string; email: string; name: string; role: Role };
}

/**
 * argon2id with parameters sized for an admin login (a handful per day), not a
 * high-throughput consumer endpoint.
 */
/** The duration form jsonwebtoken accepts for `expiresIn` ("15m", "7d", 3600). */
type Ttl = NonNullable<JwtSignOptions['expiresIn']>;

const ARGON_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP minimum
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto, ip: string): Promise<AuthResult> {
    const admin = await this.prisma.admins.findUnique({ where: { email: dto.email } });

    // Same error and roughly the same work whether the email exists or not, so
    // the response cannot be used to enumerate valid admin accounts.
    if (!admin) {
      await argon2.hash(dto.password, ARGON_OPTS).catch(() => undefined);
      throw new UnauthorizedException('ອີເມວ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ · Invalid credentials');
    }

    const ok = await argon2.verify(admin.password_hash, dto.password).catch(() => false);
    if (!ok) {
      throw new UnauthorizedException('ອີເມວ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ · Invalid credentials');
    }

    if (!isRole(admin.role)) {
      throw new UnauthorizedException(`ສິດບໍ່ຖືກຕ້ອງ · Unknown role "${admin.role}"`);
    }

    await this.prisma.admins.update({
      where: { id: admin.id },
      data: { last_login_at: new Date() },
    });

    await this.prisma.audit_logs.create({
      data: { actor_type: 'admin', actor_id: admin.id, action: 'login', target: 'admins:' + admin.id, ip_address: ip },
    });

    const tokens = await this.issueTokens(admin.id, admin.email, admin.role, ip);
    return {
      ...tokens,
      admin: { id: admin.id.toString(), email: admin.email, name: admin.name, role: admin.role },
    };
  }

  /**
   * Self-service registration is only open while no admin exists yet — it
   * bootstraps the very first super_admin. After that, accounts are created
   * from the Settings screen by an existing super_admin.
   */
  async register(dto: RegisterAdminDto, ip: string): Promise<AuthResult> {
    const existingCount = await this.prisma.admins.count();
    if (existingCount > 0) {
      throw new ConflictException(
        'ມີຜູ້ດູແລໃນລະບົບແລ້ວ — ໃຫ້ super_admin ເປັນຜູ້ສ້າງບັນຊີໃໝ່ · ' +
          'Registration is closed; ask a super_admin to create the account',
      );
    }

    const admin = await this.createAdmin({ ...dto, role: ROLE.SUPER_ADMIN });
    this.logger.log(`Bootstrap super_admin created: ${admin.email}`);

    const tokens = await this.issueTokens(admin.id, admin.email, ROLE.SUPER_ADMIN, ip);
    return {
      ...tokens,
      admin: {
        id: admin.id.toString(),
        email: admin.email,
        name: admin.name,
        role: ROLE.SUPER_ADMIN,
      },
    };
  }

  /** Shared by bootstrap registration and by the Settings screen. */
  async createAdmin(dto: RegisterAdminDto) {
    const password_hash = await argon2.hash(dto.password, ARGON_OPTS);
    return this.prisma.admins.create({
      data: { email: dto.email, name: dto.name, password_hash, role: dto.role },
      select: { id: true, email: true, name: true, role: true, last_login_at: true },
    });
  }

  /**
   * Refresh with rotation: the presented token is revoked and a new pair is
   * issued. Reusing an already-revoked token revokes the whole family, which
   * is the standard response to a stolen refresh token.
   */
  async refresh(refreshToken: string, ip: string): Promise<TokenPair> {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token ບໍ່ຖືກຕ້ອງ ຫຼື ໝົດອາຍຸ · Invalid or expired');
    }

    const hash = hashToken(refreshToken);
    const stored = await this.prisma.refresh_tokens.findUnique({ where: { token_hash: hash } });

    if (!stored) {
      throw new UnauthorizedException('Refresh token ບໍ່ຖືກຕ້ອງ · Unknown token');
    }

    if (stored.revoked_at) {
      // Replay of a rotated token — treat the session as compromised.
      await this.revokeAllForAdmin(stored.admin_id);
      this.logger.warn(`Refresh token reuse detected for admin ${stored.admin_id}; all sessions revoked`);
      throw new UnauthorizedException('Session ຖືກຍົກເລີກ · Session revoked, please log in again');
    }

    if (stored.expires_at < new Date()) {
      throw new UnauthorizedException('Refresh token ໝົດອາຍຸ · Expired');
    }

    const admin = await this.prisma.admins.findUnique({ where: { id: BigInt(payload.sub) } });
    if (!admin || !isRole(admin.role)) {
      throw new UnauthorizedException('ບັນຊີບໍ່ມີຢູ່ແລ້ວ · Account no longer exists');
    }

    await this.prisma.refresh_tokens.update({
      where: { id: stored.id },
      data: { revoked_at: new Date() },
    });

    return this.issueTokens(admin.id, admin.email, admin.role, ip);
  }

  async logout(refreshToken: string): Promise<{ ok: true }> {
    // Revoking an unknown or already-revoked token is not an error: the caller
    // wanted the session gone and it is gone.
    await this.prisma.refresh_tokens
      .updateMany({
        where: { token_hash: hashToken(refreshToken), revoked_at: null },
        data: { revoked_at: new Date() },
      })
      .catch(() => undefined);
    return { ok: true };
  }

  async revokeAllForAdmin(adminId: bigint): Promise<void> {
    await this.prisma.refresh_tokens.updateMany({
      where: { admin_id: adminId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  private async issueTokens(id: bigint, email: string, role: Role, ip: string): Promise<TokenPair> {
    // jsonwebtoken types expiresIn as a template-literal duration ("15m"), which
    // a plain string from .env cannot satisfy — hence the cast.
    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL', '15m') as Ttl;
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL', '7d') as Ttl;

    const accessToken = await this.jwt.signAsync(
      { sub: id.toString(), email, role },
      { secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: accessTtl },
    );

    // A random jti keeps two refresh tokens issued in the same second distinct,
    // so their hashes never collide on the unique index.
    const refreshToken = await this.jwt.signAsync(
      { sub: id.toString(), jti: randomBytes(16).toString('hex') },
      { secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), expiresIn: refreshTtl },
    );

    await this.prisma.refresh_tokens.create({
      data: {
        admin_id: id,
        token_hash: hashToken(refreshToken),
        expires_at: addDuration(new Date(), String(refreshTtl)),
        ip_address: ip,
      },
    });

    return { accessToken, refreshToken, expiresIn: String(accessTtl) };
  }
}

/**
 * Refresh tokens are stored as SHA-256 digests. A leaked database dump then
 * yields no usable tokens. argon2 is unnecessary here: the token is 200+ bits
 * of entropy already, so there is nothing to brute-force.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Understands the "15m" / "7d" / "3600" forms used in .env. */
function addDuration(from: Date, ttl: string): Date {
  const match = /^(\d+)\s*([smhd])?$/.exec(ttl.trim());
  if (!match) return new Date(from.getTime() + 7 * 86_400_000);
  const n = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] ?? 's'] ?? 1000;
  return new Date(from.getTime() + n * unitMs);
}
