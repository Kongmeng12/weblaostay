import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { isRole } from '../../common/roles';
import { ACTOR, STRATEGY } from '../../common/actors';
import type { AuthedAdmin } from '../../common/decorators';
import { assertActorType, type AccessTokenPayload } from './payload';

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, STRATEGY[ACTOR.ADMIN]) {
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
    assertActorType(payload, ACTOR.ADMIN);

    const admin = await this.prisma.admins.findUnique({
      where: { id: BigInt(payload.sub) },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!admin) throw new UnauthorizedException('ບັນຊີບໍ່ມີຢູ່ແລ້ວ · Account no longer exists');
    if (!isRole(admin.role)) {
      throw new UnauthorizedException(`ສິດບໍ່ຖືກຕ້ອງ · Unknown role "${admin.role}"`);
    }

    return {
      actorType: ACTOR.ADMIN,
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    };
  }
}
