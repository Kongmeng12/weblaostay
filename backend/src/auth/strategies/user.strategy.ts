import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ACTOR, STRATEGY } from '../../common/actors';
import { USER_STATUS } from '../../common/money';
import type { AuthedUser } from '../../common/decorators';
import { assertActorType, type AccessTokenPayload } from './payload';

@Injectable()
export class UserJwtStrategy extends PassportStrategy(Strategy, STRATEGY[ACTOR.USER]) {
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

  async validate(payload: AccessTokenPayload): Promise<AuthedUser> {
    assertActorType(payload, ACTOR.USER);

    const user = await this.prisma.users.findUnique({
      where: { id: BigInt(payload.sub) },
      select: { id: true, email: true, full_name: true, status: true },
    });

    if (!user) throw new UnauthorizedException('ບັນຊີບໍ່ມີຢູ່ແລ້ວ · Account no longer exists');
    // Suspension is applied from the admin Customers screen and must bite at
    // once, so it is checked here rather than per route.
    if (user.status === USER_STATUS.SUSPENDED) {
      throw new ForbiddenException('ບັນຊີຖືກລະງັບ · This account is suspended');
    }

    return {
      actorType: ACTOR.USER,
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      status: user.status ?? USER_STATUS.ACTIVE,
    };
  }
}
