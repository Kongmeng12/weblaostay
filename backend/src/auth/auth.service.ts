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
import {
  LoginDto,
  RegisterAdminDto,
  RegisterPartnerDto,
  RegisterCustomerDto,
} from './dto/auth.dto';
import { ROLE, isRole, type Role } from '../common/roles';
import { ACTOR, type ActorType } from '../common/actors';
import { PARTNER_STATUS } from '../common/money';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface AuthResult extends TokenPair {
  admin: { id: string; email: string; name: string; role: Role };
}

export interface PartnerAuthResult extends TokenPair {
  partner: { id: string; email: string; ownerName: string; phone: string; status: string };
}

export interface CustomerAuthResult extends TokenPair {
  user: { id: string; email: string; fullName: string; phone: string; tier: string };
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

const BAD_CREDENTIALS = 'ອີເມວ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ · Invalid credentials';

/** Which `refresh_tokens` column owns a session, per actor. */
const OWNER_COLUMN = {
  [ACTOR.ADMIN]: 'admin_id',
  [ACTOR.PARTNER]: 'partner_id',
  [ACTOR.USER]: 'user_id',
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ── admin ─────────────────────────────────────────────────────────────────

  async login(dto: LoginDto, ip: string): Promise<AuthResult> {
    const admin = await this.prisma.admins.findUnique({ where: { email: dto.email } });

    // Same error and roughly the same work whether the email exists or not, so
    // the response cannot be used to enumerate valid admin accounts.
    if (!admin) {
      await argon2.hash(dto.password, ARGON_OPTS).catch(() => undefined);
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }

    const ok = await argon2.verify(admin.password_hash, dto.password).catch(() => false);
    if (!ok) throw new UnauthorizedException(BAD_CREDENTIALS);

    if (!isRole(admin.role)) {
      throw new UnauthorizedException(`ສິດບໍ່ຖືກຕ້ອງ · Unknown role "${admin.role}"`);
    }

    await this.prisma.admins.update({
      where: { id: admin.id },
      data: { last_login_at: new Date() },
    });

    await this.prisma.audit_logs.create({
      data: { actor_type: ACTOR.ADMIN, actor_id: admin.id, action: 'login', target: 'admins:' + admin.id, ip_address: ip },
    });

    const tokens = await this.issueTokens(ACTOR.ADMIN, admin.id, admin.email, ip, admin.role);
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

    const tokens = await this.issueTokens(
      ACTOR.ADMIN,
      admin.id,
      admin.email,
      ip,
      ROLE.SUPER_ADMIN,
    );
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

  // ── partner ───────────────────────────────────────────────────────────────

  async partnerLogin(dto: LoginDto, ip: string): Promise<PartnerAuthResult> {
    const partner = await this.prisma.partners.findUnique({ where: { email: dto.email } });

    if (!partner) {
      await argon2.hash(dto.password, ARGON_OPTS).catch(() => undefined);
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }

    const ok = await argon2.verify(partner.password_hash, dto.password).catch(() => false);
    if (!ok) throw new UnauthorizedException(BAD_CREDENTIALS);

    // A pending partner may sign in — the app shows them "under review". Only a
    // rejected application is turned away here.
    if (partner.status === PARTNER_STATUS.REJECTED) {
      throw new UnauthorizedException('ໃບສະໝັກບໍ່ຜ່ານການອະນຸມັດ · Application was rejected');
    }

    await this.prisma.audit_logs.create({
      data: {
        actor_type: ACTOR.PARTNER,
        actor_id: partner.id,
        action: 'login',
        target: 'partners:' + partner.id,
        ip_address: ip,
      },
    });

    const tokens = await this.issueTokens(ACTOR.PARTNER, partner.id, partner.email, ip);
    return { ...tokens, partner: partnerIdentity(partner) };
  }

  /**
   * Partner sign-up creates the account *and* its first property in one
   * transaction, both at `pending`. That is exactly the row the Approvals
   * screen already looks for, so no admin-side code changes.
   */
  async partnerRegister(dto: RegisterPartnerDto, ip: string): Promise<PartnerAuthResult> {
    const taken = await this.prisma.partners.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException('ອີເມວນີ້ມີບັນຊີແລ້ວ · That email is already registered');
    }

    const password_hash = await argon2.hash(dto.password, ARGON_OPTS);

    const partner = await this.prisma.$transaction(async (tx) => {
      const created = await tx.partners.create({
        data: {
          email: dto.email,
          password_hash,
          owner_name: dto.ownerName,
          phone: dto.phone,
          status: PARTNER_STATUS.PENDING,
          bank_name: dto.bankName ?? null,
          bank_account: dto.bankAccount ?? null,
        },
      });

      await tx.properties.create({
        data: {
          partner_id: created.id,
          name: dto.propertyName,
          type: dto.propertyType,
          province: dto.province,
          address: dto.address,
        },
      });

      return created;
    });

    this.logger.log(`Partner application received: ${partner.email}`);

    const tokens = await this.issueTokens(ACTOR.PARTNER, partner.id, partner.email, ip);
    return { ...tokens, partner: partnerIdentity(partner) };
  }

  // ── customer ──────────────────────────────────────────────────────────────

  async customerLogin(dto: LoginDto, ip: string): Promise<CustomerAuthResult> {
    const user = await this.prisma.users.findUnique({ where: { email: dto.email } });

    if (!user) {
      await argon2.hash(dto.password, ARGON_OPTS).catch(() => undefined);
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }

    const ok = await argon2.verify(user.password_hash, dto.password).catch(() => false);
    if (!ok) throw new UnauthorizedException(BAD_CREDENTIALS);

    const tokens = await this.issueTokens(ACTOR.USER, user.id, user.email, ip);
    return { ...tokens, user: customerIdentity(user) };
  }

  async customerRegister(dto: RegisterCustomerDto, ip: string): Promise<CustomerAuthResult> {
    const taken = await this.prisma.users.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException('ອີເມວນີ້ມີບັນຊີແລ້ວ · That email is already registered');
    }

    const password_hash = await argon2.hash(dto.password, ARGON_OPTS);
    const user = await this.prisma.users.create({
      data: {
        email: dto.email,
        password_hash,
        full_name: dto.fullName,
        phone: dto.phone,
      },
    });

    const tokens = await this.issueTokens(ACTOR.USER, user.id, user.email, ip);
    return { ...tokens, user: customerIdentity(user) };
  }

  // ── shared session handling ───────────────────────────────────────────────

  /**
   * Refresh with rotation: the presented token is revoked and a new pair is
   * issued. Reusing an already-revoked token revokes the whole family, which
   * is the standard response to a stolen refresh token.
   *
   * One implementation for all three actors — the stored row says which one it
   * belongs to, so there is no way for the three to drift apart.
   */
  async refresh(refreshToken: string, ip: string): Promise<TokenPair> {
    let payload: { sub: string; typ?: ActorType };
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

    const actor = actorOf(stored);
    if (!actor) {
      throw new UnauthorizedException('Refresh token ບໍ່ຖືກຕ້ອງ · Orphaned token');
    }

    if (stored.revoked_at) {
      // Replay of a rotated token — treat the session as compromised.
      await this.revokeAllFor(actor.type, actor.id);
      this.logger.warn(
        `Refresh token reuse detected for ${actor.type} ${actor.id}; all sessions revoked`,
      );
      throw new UnauthorizedException('Session ຖືກຍົກເລີກ · Session revoked, please log in again');
    }

    if (stored.expires_at < new Date()) {
      throw new UnauthorizedException('Refresh token ໝົດອາຍຸ · Expired');
    }

    const account = await this.loadAccount(actor.type, actor.id);
    if (!account) {
      throw new UnauthorizedException('ບັນຊີບໍ່ມີຢູ່ແລ້ວ · Account no longer exists');
    }

    await this.prisma.refresh_tokens.update({
      where: { id: stored.id },
      data: { revoked_at: new Date() },
    });

    return this.issueTokens(actor.type, actor.id, account.email, ip, account.role);
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
    return this.revokeAllFor(ACTOR.ADMIN, adminId);
  }

  async revokeAllFor(actorType: ActorType, id: bigint): Promise<void> {
    await this.prisma.refresh_tokens.updateMany({
      where: { [OWNER_COLUMN[actorType]]: id, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  private async loadAccount(
    actorType: ActorType,
    id: bigint,
  ): Promise<{ email: string; role?: Role } | null> {
    if (actorType === ACTOR.ADMIN) {
      const admin = await this.prisma.admins.findUnique({
        where: { id },
        select: { email: true, role: true },
      });
      if (!admin || !isRole(admin.role)) return null;
      return { email: admin.email, role: admin.role };
    }

    if (actorType === ACTOR.PARTNER) {
      const partner = await this.prisma.partners.findUnique({
        where: { id },
        select: { email: true, status: true },
      });
      if (!partner || partner.status === PARTNER_STATUS.REJECTED) return null;
      return { email: partner.email };
    }

    const user = await this.prisma.users.findUnique({ where: { id }, select: { email: true } });
    return user ? { email: user.email } : null;
  }

  private async issueTokens(
    actorType: ActorType,
    id: bigint,
    email: string,
    ip: string,
    role?: Role,
  ): Promise<TokenPair> {
    // jsonwebtoken types expiresIn as a template-literal duration ("15m"), which
    // a plain string from .env cannot satisfy — hence the cast.
    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL', '15m') as Ttl;
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL', '7d') as Ttl;

    // `typ` is what keeps the three actors apart: all tokens share one secret,
    // so each passport strategy refuses a payload whose typ is not its own.
    const accessToken = await this.jwt.signAsync(
      { sub: id.toString(), typ: actorType, email, ...(role ? { role } : {}) },
      { secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: accessTtl },
    );

    // A random jti keeps two refresh tokens issued in the same second distinct,
    // so their hashes never collide on the unique index.
    const refreshToken = await this.jwt.signAsync(
      { sub: id.toString(), typ: actorType, jti: randomBytes(16).toString('hex') },
      { secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), expiresIn: refreshTtl },
    );

    await this.prisma.refresh_tokens.create({
      data: {
        [OWNER_COLUMN[actorType]]: id,
        token_hash: hashToken(refreshToken),
        expires_at: addDuration(new Date(), String(refreshTtl)),
        ip_address: ip,
      },
    });

    return { accessToken, refreshToken, expiresIn: String(accessTtl) };
  }
}

/** Which actor a stored session belongs to — exactly one column is set. */
function actorOf(row: {
  admin_id: bigint | null;
  partner_id: bigint | null;
  user_id: bigint | null;
}): { type: ActorType; id: bigint } | null {
  if (row.admin_id !== null) return { type: ACTOR.ADMIN, id: row.admin_id };
  if (row.partner_id !== null) return { type: ACTOR.PARTNER, id: row.partner_id };
  if (row.user_id !== null) return { type: ACTOR.USER, id: row.user_id };
  return null;
}

function partnerIdentity(p: {
  id: bigint;
  email: string;
  owner_name: string;
  phone: string;
  status: string | null;
}) {
  return {
    id: p.id.toString(),
    email: p.email,
    ownerName: p.owner_name,
    phone: p.phone,
    status: p.status ?? PARTNER_STATUS.PENDING,
  };
}

function customerIdentity(u: {
  id: bigint;
  email: string;
  full_name: string;
  phone: string;
  tier: string | null;
}) {
  return {
    id: u.id.toString(),
    email: u.email,
    fullName: u.full_name,
    phone: u.phone,
    tier: u.tier ?? 'silver',
  };
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
