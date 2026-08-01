import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ACTOR, STRATEGY } from '../../common/actors';
import { PARTNER_STATUS } from '../../common/money';
import type { AuthedPartner } from '../../common/decorators';
import { assertActorType, type AccessTokenPayload } from './payload';

@Injectable()
export class PartnerJwtStrategy extends PassportStrategy(Strategy, STRATEGY[ACTOR.PARTNER]) {
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
   * Re-read on every request, like the admin strategy: a partner rejected on
   * the Approvals screen must lose access immediately, not when their access
   * token happens to expire.
   *
   * `pending` is deliberately allowed through — the partner needs to sign in to
   * see that their application is still under review. Individual routes that
   * require an approved account check `status` themselves.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthedPartner> {
    assertActorType(payload, ACTOR.PARTNER);

    const partner = await this.prisma.partners.findUnique({
      where: { id: BigInt(payload.sub) },
      select: { id: true, email: true, owner_name: true, status: true },
    });

    if (!partner) throw new UnauthorizedException('ບັນຊີບໍ່ມີຢູ່ແລ້ວ · Account no longer exists');
    if (partner.status === PARTNER_STATUS.REJECTED) {
      throw new ForbiddenException('ໃບສະໝັກບໍ່ຜ່ານການອະນຸມັດ · Application was rejected');
    }

    return {
      actorType: ACTOR.PARTNER,
      id: partner.id,
      email: partner.email,
      ownerName: partner.owner_name,
      status: partner.status ?? PARTNER_STATUS.PENDING,
    };
  }
}
