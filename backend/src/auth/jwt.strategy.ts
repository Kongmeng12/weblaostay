import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { user_role, user_status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthedUser } from '../common/decorators';

export interface AccessTokenPayload {
  /** users.user_id as a string — BigInt does not survive JSON. */
  sub: string;
  email: string;
  role: user_role;
}

/**
 * The single authentication strategy.
 *
 * v1 ran three of these because admins, partners and customers were three
 * tables, which meant a guard had to pick one per route and a `typ` claim had
 * to keep the tokens apart. v2 has one `users` table, so there is one strategy,
 * one token shape, and nothing to pick.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /**
   * The row is re-read on every request rather than trusted from the token, so
   * a suspension, a role change or a deletion bites at once instead of
   * lingering until the 15-minute access token expires.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthedUser> {
    const user = await this.prisma.users.findUnique({
      where: { user_id: BigInt(payload.sub) },
      select: {
        user_id: true,
        email: true,
        role: true,
        admin_role: true,
        status: true,
        is_verified: true,
        deleted_at: true,
        partners: { select: { partner_id: true } },
        user_profiles: { select: { full_name: true } },
      },
    });

    if (!user || user.deleted_at !== null) {
      throw new UnauthorizedException('ບັນຊີບໍ່ມີຢູ່ແລ້ວ · Account no longer exists');
    }
    if (user.status === user_status.suspended) {
      throw new ForbiddenException('ບັນຊີຖືກລະງັບ · This account is suspended');
    }

    return {
      userId: user.user_id,
      email: user.email,
      role: user.role,
      adminRole: user.admin_role,
      partnerId: user.partners?.partner_id ?? null,
      fullName: user.user_profiles?.full_name ?? null,
      isVerified: user.is_verified,
    };
  }
}
