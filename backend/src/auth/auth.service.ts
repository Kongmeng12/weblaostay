import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  agreement_doc_type,
  user_role,
  user_status,
  type otp_purpose,
} from '@prisma/client';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../common/settings.service';
import { PasswordService } from './password.service';
import { LoginGuardService } from './login-guard.service';
import { AgreementsService, SIGNUP_DOCS } from './agreements.service';
import {
  SMS_PROVIDER,
  laoMobile,
  type SmsProvider,
} from '../notifications/sms-provider.interface';
import { EMAIL_PROVIDER, type EmailProvider } from '../notifications/email-provider.interface';
import { otpEmail, passwordResetEmail } from '../notifications/emails';
import type {
  LoginDto,
  RegisterCustomerDto,
  RegisterPartnerDto,
} from './dto/auth.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface Identity {
  id: string;
  email: string;
  role: user_role;
  adminRole: string | null;
  fullName: string | null;
  phone: string | null;
  isVerified: boolean;
  partnerId: string | null;
  partnerStatus: string | null;
}

export interface AuthResult extends TokenPair {
  user: Identity;
}

/** The duration form jsonwebtoken accepts for `expiresIn` ("15m", "7d", 3600). */
type Ttl = NonNullable<JwtSignOptions['expiresIn']>;

const BAD_CREDENTIALS = 'ອີເມວ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ · Invalid credentials';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly passwords: PasswordService,
    private readonly loginGuard: LoginGuardService,
    private readonly agreements: AgreementsService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  // ── sign in ───────────────────────────────────────────────────────────────

  async login(dto: LoginDto, ip: string, userAgent: string | null): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();

    // Lockout is checked before any password work, so a locked account costs an
    // attacker a cheap 429 rather than a hash verification.
    await this.loginGuard.assertNotLocked(email);

    const user = await this.prisma.users.findUnique({
      where: { email },
      include: { user_profiles: true, partners: true },
    });

    if (!user || user.deleted_at !== null) {
      // Same work and the same error whether the account exists or not, so the
      // response cannot be used to enumerate accounts.
      await this.passwords.wasteTime(dto.password);
      await this.loginGuard.record(email, false, ip, userAgent);
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }

    const { ok, needsRehash } = await this.passwords.verify(dto.password, user.password_hash);
    if (!ok) {
      await this.loginGuard.record(email, false, ip, userAgent);
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }

    if (user.status === user_status.suspended) {
      await this.loginGuard.record(email, false, ip, userAgent);
      throw new UnauthorizedException('ບັນຊີຖືກລະງັບ · This account is suspended');
    }

    // The seed writes bcrypt; move it to argon2 now that we hold the plaintext.
    if (needsRehash) {
      void this.passwords.upgradeInBackground(user.user_id, dto.password, (id, hash) =>
        this.prisma.users.update({ where: { user_id: id }, data: { password_hash: hash } }),
      );
    }

    await Promise.all([
      this.prisma.users.update({
        where: { user_id: user.user_id },
        data: { last_login_at: new Date() },
      }),
      this.loginGuard.record(email, true, ip, userAgent),
      this.loginGuard.clearFailures(email),
      this.prisma.audit_logs.create({
        data: {
          user_id: user.user_id,
          action: 'login',
          module_name: 'auth',
          table_name: 'users',
          record_id: user.user_id,
          ip_address: ip.slice(0, 64),
          user_agent: userAgent,
        },
      }),
    ]);

    const tokens = await this.issueTokens(user.user_id, user.email, user.role, ip, userAgent);
    return { ...tokens, user: toIdentity(user) };
  }

  // ── registration ──────────────────────────────────────────────────────────

  async registerCustomer(
    dto: RegisterCustomerDto,
    ip: string,
    userAgent: string | null,
  ): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();
    await this.assertEmailFree(email);

    const password_hash = await this.passwords.hash(dto.password);

    // The account and the record of what they agreed to are one commit. An
    // account with no agreement row would be a person we cannot show consented.
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.users.create({
        data: {
          role: user_role.CUSTOMER,
          email,
          phone: dto.phone,
          password_hash,
          user_profiles: { create: { full_name: dto.fullName } },
        },
      });

      await this.agreements.record(tx, created.user_id, SIGNUP_DOCS, ip);

      return tx.users.findUniqueOrThrow({
        where: { user_id: created.user_id },
        include: { user_profiles: true, partners: true },
      });
    });

    const tokens = await this.issueTokens(user.user_id, user.email, user.role, ip, userAgent);
    return { ...tokens, user: toIdentity(user) };
  }

  /**
   * Partner sign-up creates the account, the business and its first property in
   * one transaction, all at `pending`. That is exactly the row the Approvals
   * screen looks for, so no admin-side code has to know registration happened.
   */
  async registerPartner(
    dto: RegisterPartnerDto,
    ip: string,
    userAgent: string | null,
  ): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();
    await this.assertEmailFree(email);

    const password_hash = await this.passwords.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.users.create({
        data: {
          role: user_role.PARTNER,
          email,
          phone: dto.phone,
          password_hash,
          user_profiles: { create: { full_name: dto.ownerName } },
        },
      });

      const partner = await tx.partners.create({
        data: {
          user_id: created.user_id,
          business_name: dto.businessName,
          contact_phone: dto.phone,
        },
      });

      await tx.properties.create({
        data: {
          partner_id: partner.partner_id,
          property_name: dto.propertyName,
          property_type: dto.propertyType,
          province_id: BigInt(dto.provinceId),
          district_id: dto.districtId ? BigInt(dto.districtId) : null,
          address_detail: dto.address,
          // Not sellable until an admin approves the partner.
          status: 'draft',
        },
      });

      // A partner accepts the partner agreement on top of the two everyone
      // accepts — they are entering a commercial relationship, not just an
      // account.
      await this.agreements.record(
        tx,
        created.user_id,
        [...SIGNUP_DOCS, agreement_doc_type.partner_agreement],
        ip,
      );

      return tx.users.findUniqueOrThrow({
        where: { user_id: created.user_id },
        include: { user_profiles: true, partners: true },
      });
    });

    this.logger.log(`Partner application received: ${email}`);

    const tokens = await this.issueTokens(user.user_id, user.email, user.role, ip, userAgent);
    return { ...tokens, user: toIdentity(user) };
  }

  // ── sessions ──────────────────────────────────────────────────────────────

  /**
   * Refresh with rotation: the presented token is revoked and a new pair is
   * issued. Reusing an already-revoked token revokes every session for that
   * user, which is the standard response to a stolen refresh token.
   */
  async refresh(refreshToken: string, ip: string, userAgent: string | null): Promise<TokenPair> {
    try {
      await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token ບໍ່ຖືກຕ້ອງ ຫຼື ໝົດອາຍຸ · Invalid or expired');
    }

    const stored = await this.prisma.user_sessions.findUnique({
      where: { refresh_token_hash: hashToken(refreshToken) },
      include: { users: true },
    });

    if (!stored) throw new UnauthorizedException('Refresh token ບໍ່ຖືກຕ້ອງ · Unknown token');

    if (stored.revoked_at) {
      await this.revokeAllSessions(stored.user_id);
      this.logger.warn(
        `Refresh token reuse detected for user ${stored.user_id}; all sessions revoked`,
      );
      throw new UnauthorizedException('Session ຖືກຍົກເລີກ · Session revoked, please sign in again');
    }

    if (stored.expires_at < new Date()) {
      throw new UnauthorizedException('Refresh token ໝົດອາຍຸ · Expired');
    }
    if (stored.users.deleted_at !== null || stored.users.status === user_status.suspended) {
      throw new UnauthorizedException('ບັນຊີໃຊ້ບໍ່ໄດ້ແລ້ວ · Account is no longer active');
    }

    await this.prisma.user_sessions.update({
      where: { session_id: stored.session_id },
      data: { revoked_at: new Date() },
    });

    return this.issueTokens(
      stored.users.user_id,
      stored.users.email,
      stored.users.role,
      ip,
      userAgent,
    );
  }

  async logout(refreshToken: string): Promise<{ ok: true }> {
    // Revoking an unknown or already-revoked token is not an error: the caller
    // wanted the session gone and it is gone.
    await this.prisma.user_sessions
      .updateMany({
        where: { refresh_token_hash: hashToken(refreshToken), revoked_at: null },
        data: { revoked_at: new Date() },
      })
      .catch(() => undefined);
    return { ok: true };
  }

  async revokeAllSessions(userId: bigint): Promise<void> {
    await this.prisma.user_sessions.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  async me(userId: bigint): Promise<Identity> {
    const user = await this.prisma.users.findUniqueOrThrow({
      where: { user_id: userId },
      include: { user_profiles: true, partners: true },
    });
    return toIdentity(user);
  }

  // ── OTP ───────────────────────────────────────────────────────────────────

  /**
   * Issues a one-time code.
   *
   * The code is stored hashed, like a password: a leaked table dump must not
   * hand over live codes. Off production the code is also returned in the
   * response, so the endpoint stays testable without spending SMS credit.
   *
   * A phone target is texted and an email target is emailed, so one endpoint
   * serves both sign-up paths.
   */
  async requestOtp(
    target: string,
    purpose: otp_purpose,
  ): Promise<{ sent: true; expiresAt: Date; devCode?: string }> {
    const { otp_ttl_minutes, otp_max_attempts } = await this.settings.get();
    const code = randomInt(100_000, 999_999).toString();
    const expiresAt = new Date(Date.now() + otp_ttl_minutes * 60_000);

    const user = await this.prisma.users.findFirst({
      where: { OR: [{ email: target.toLowerCase() }, { phone: target }] },
      select: { user_id: true },
    });

    await this.prisma.otp_verifications.create({
      data: {
        user_id: user?.user_id ?? null,
        target,
        purpose,
        code_hash: hashToken(code),
        max_attempts: otp_max_attempts,
        expires_at: expiresAt,
      },
    });

    const isProduction = this.config.get<string>('NODE_ENV') === 'production';

    // A phone number gets a text, an address gets an email. Nothing is awaited
    // and nothing is rethrown: the answer must take the same time and say the
    // same thing whether or not the target belongs to anyone, and a slow
    // gateway must not become the caller's error. A failure is logged — that is
    // where it is actionable.
    const failed = (err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Could not send the OTP to ${target}: ${detail}`);
    };

    if (laoMobile(target)) {
      // Deliberately plain ASCII: Wenova bills per segment, and one Lao
      // character drops a segment from 153 characters to 67.
      void this.sms
        .send(target, `LaoStay code: ${code}. Valid ${otp_ttl_minutes} minutes.`)
        .catch(failed);
    } else if (target.includes('@')) {
      void this.email.send(otpEmail(target, code, otp_ttl_minutes)).catch(failed);
    }

    if (!isProduction) this.logger.warn(`OTP for ${target} (${purpose}): ${code}`);

    return { sent: true, expiresAt, ...(isProduction ? {} : { devCode: code }) };
  }

  async verifyOtp(target: string, purpose: otp_purpose, code: string): Promise<{ verified: true }> {
    const otp = await this.prisma.otp_verifications.findFirst({
      where: { target, purpose, verified_at: null },
      orderBy: { created_at: 'desc' },
    });

    if (!otp) throw new BadRequestException('ບໍ່ພົບລະຫັດ OTP · No pending code for that target');
    if (otp.expires_at < new Date()) {
      throw new BadRequestException('ລະຫັດ OTP ໝົດອາຍຸ · The code has expired');
    }
    if (otp.attempts >= otp.max_attempts) {
      throw new BadRequestException('ໃສ່ລະຫັດຜິດຫຼາຍເທື່ອເກີນໄປ · Too many attempts, request a new code');
    }

    if (otp.code_hash !== hashToken(code)) {
      await this.prisma.otp_verifications.update({
        where: { otp_id: otp.otp_id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('ລະຫັດ OTP ບໍ່ຖືກຕ້ອງ · Incorrect code');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.otp_verifications.update({
        where: { otp_id: otp.otp_id },
        data: { verified_at: new Date() },
      });
      if (otp.user_id && otp.purpose === 'verify') {
        await tx.users.update({
          where: { user_id: otp.user_id },
          data: { is_verified: true },
        });
      }
    });

    return { verified: true };
  }

  // ── password reset ────────────────────────────────────────────────────────

  /**
   * Always reports success, whether or not the email exists — the response must
   * not reveal which addresses have accounts.
   */
  async requestPasswordReset(email: string): Promise<{ sent: true; devToken?: string }> {
    const { password_reset_ttl_minutes } = await this.settings.get();
    const user = await this.prisma.users.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { user_id: true, deleted_at: true },
    });

    if (!user || user.deleted_at) return { sent: true };

    const token = randomBytes(32).toString('hex');
    await this.prisma.password_reset_tokens.create({
      data: {
        user_id: user.user_id,
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + password_reset_ttl_minutes * 60_000),
      },
    });

    const isProduction = this.config.get<string>('NODE_ENV') === 'production';

    // Nothing is awaited and nothing is rethrown. The response must take the
    // same time and say the same thing whether or not the address exists, and a
    // slow mail server must not become the caller's error. A failure is logged —
    // that is where somebody can act on it.
    const link = `${this.appUrl()}/forgot?token=${token}`;
    void this.email
      .send(passwordResetEmail(email, link, password_reset_ttl_minutes))
      .catch((err: unknown) => {
        const detail = err instanceof Error ? err.message : String(err);
        this.logger.error(`Could not email the reset link to ${email}: ${detail}`);
      });

    if (!isProduction) this.logger.warn(`Password reset token for ${email}: ${token}`);

    return { sent: true, ...(isProduction ? {} : { devToken: token }) };
  }

  /**
   * Where the customer app lives, for links that have to leave the API.
   *
   * `CORS_ORIGIN` already lists it and is already required to be right, so the
   * first entry is used rather than adding a second variable that can disagree
   * with it.
   */
  private appUrl(): string {
    const origins = this.config.get<string>('CORS_ORIGIN') ?? '';
    const first = origins.split(',')[0]?.trim();
    return (first || 'http://localhost:5173').replace(/\/+$/, '');
  }

  async resetPassword(token: string, newPassword: string): Promise<{ ok: true }> {
    const row = await this.prisma.password_reset_tokens.findUnique({
      where: { token_hash: hashToken(token) },
    });

    if (!row || row.used_at || row.expires_at < new Date()) {
      throw new BadRequestException('ລິ້ງບໍ່ຖືກຕ້ອງ ຫຼື ໝົດອາຍຸ · Invalid or expired reset link');
    }

    const password_hash = await this.passwords.hash(newPassword);

    await this.prisma.$transaction([
      this.prisma.users.update({
        where: { user_id: row.user_id },
        data: { password_hash },
      }),
      this.prisma.password_reset_tokens.update({
        where: { token_id: row.token_id },
        data: { used_at: new Date() },
      }),
      // Changing a password ends every other session — that is the point of
      // resetting it after a compromise.
      this.prisma.user_sessions.updateMany({
        where: { user_id: row.user_id, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    ]);

    return { ok: true };
  }

  async changePassword(userId: bigint, current: string, next: string): Promise<{ ok: true }> {
    const user = await this.prisma.users.findUniqueOrThrow({
      where: { user_id: userId },
      select: { password_hash: true },
    });

    const { ok } = await this.passwords.verify(current, user.password_hash);
    if (!ok) throw new UnauthorizedException('ລະຫັດຜ່ານປັດຈຸບັນບໍ່ຖືກຕ້ອງ · Current password is wrong');

    const password_hash = await this.passwords.hash(next);
    await this.prisma.$transaction([
      this.prisma.users.update({ where: { user_id: userId }, data: { password_hash } }),
      this.prisma.user_sessions.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    ]);

    return { ok: true };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async assertEmailFree(email: string): Promise<void> {
    const taken = await this.prisma.users.findUnique({
      where: { email },
      select: { user_id: true },
    });
    if (taken) throw new ConflictException('ອີເມວນີ້ມີບັນຊີແລ້ວ · That email is already registered');
  }

  private async issueTokens(
    userId: bigint,
    email: string,
    role: user_role,
    ip: string,
    userAgent: string | null,
  ): Promise<TokenPair> {
    const { access_token_ttl, refresh_token_ttl } = await this.settings.get();
    // jsonwebtoken types expiresIn as a template-literal duration ("15m"),
    // which a plain string from the database cannot satisfy — hence the cast.
    const accessTtl = access_token_ttl as Ttl;
    const refreshTtl = refresh_token_ttl as Ttl;

    const accessToken = await this.jwt.signAsync(
      { sub: userId.toString(), email, role },
      { secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: accessTtl },
    );

    // A random jti keeps two refresh tokens issued in the same second distinct,
    // so their hashes never collide on the unique index.
    const refreshToken = await this.jwt.signAsync(
      { sub: userId.toString(), jti: randomBytes(16).toString('hex') },
      { secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), expiresIn: refreshTtl },
    );

    await this.prisma.user_sessions.create({
      data: {
        user_id: userId,
        refresh_token_hash: hashToken(refreshToken),
        expires_at: addDuration(new Date(), String(refreshTtl)),
        ip_address: ip.slice(0, 64),
        user_agent: userAgent,
      },
    });

    return { accessToken, refreshToken, expiresIn: String(accessTtl) };
  }
}

type UserWithRelations = Prisma.usersGetPayload<{
  include: { user_profiles: true; partners: true };
}>;

function toIdentity(user: UserWithRelations): Identity {
  return {
    id: user.user_id.toString(),
    email: user.email,
    role: user.role,
    adminRole: user.admin_role,
    fullName: user.user_profiles?.full_name ?? null,
    phone: user.phone,
    isVerified: user.is_verified,
    partnerId: user.partners?.partner_id.toString() ?? null,
    partnerStatus: user.partners?.status ?? null,
  };
}

/**
 * Refresh tokens, OTP codes and reset tokens are stored as SHA-256 digests. A
 * leaked database dump then yields nothing usable. argon2 is unnecessary here:
 * these are high-entropy random values, so there is nothing to brute-force.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Understands the "15m" / "7d" / "3600" forms stored in system_settings. */
function addDuration(from: Date, ttl: string): Date {
  const match = /^(\d+)\s*([smhd])?$/.exec(ttl.trim());
  if (!match) return new Date(from.getTime() + 7 * 86_400_000);
  const n = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] ?? 's'] ?? 1000;
  return new Date(from.getTime() + n * unitMs);
}
