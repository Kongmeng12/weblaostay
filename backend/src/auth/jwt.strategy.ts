import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { isRole, type Role } from '../common/roles';
import type { AuthedAdmin } from '../common/decorators';

export interface AccessTokenPayload {
  sub: string; // admin id as string — BigInt does not survive JSON
  email: string;
  role: Role;
}

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
   * The admin row is re-read on every request rather than trusted from the
   * token. A role downgrade or a deleted account then takes effect at once,
   * instead of lingering until the 15-minute access token expires.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthedAdmin> {
    const admin = await this.prisma.admins.findUnique({
      where: { id: BigInt(payload.sub) },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!admin) throw new UnauthorizedException('ບັນຊີບໍ່ມີຢູ່ແລ້ວ · Account no longer exists');
    if (!isRole(admin.role)) {
      throw new UnauthorizedException(`ສິດບໍ່ຖືກຕ້ອງ · Unknown role "${admin.role}"`);
    }

    return { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
  }
}
