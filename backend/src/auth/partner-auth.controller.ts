import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, RegisterPartnerDto } from './dto/auth.dto';
import {
  Public,
  Actor,
  CurrentPartner,
  ClientIp,
  type AuthedPartner,
} from '../common/decorators';
import { ACTOR } from '../common/actors';

/**
 * Partner sign-in for the Flutter app. Refresh and logout are shared with the
 * admin panel (`/auth/refresh`, `/auth/logout`) — the stored session row knows
 * which actor it belongs to, so one endpoint serves all three.
 */
@Controller('auth/partner')
@Actor(ACTOR.PARTNER)
export class PartnerAuthController {
  constructor(private readonly auth: AuthService) {}

  /** 5 attempts per minute per IP — enough for a typo, not for brute force. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @ClientIp() ip: string) {
    return this.auth.partnerLogin(dto, ip);
  }

  /** Open registration: it creates a `pending` application, not an active account. */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterPartnerDto, @ClientIp() ip: string) {
    return this.auth.partnerRegister(dto, ip);
  }

  @Get('me')
  me(@CurrentPartner() partner: AuthedPartner) {
    return {
      id: partner.id.toString(),
      email: partner.email,
      ownerName: partner.ownerName,
      status: partner.status,
    };
  }
}
