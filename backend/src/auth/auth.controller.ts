import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  LoginDto,
  RefreshDto,
  RegisterCustomerDto,
  RegisterPartnerDto,
  RequestOtpDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from './dto/auth.dto';
import {
  ClientIp,
  CurrentUser,
  Public,
  UserAgent,
  type AuthedUser,
} from '../common/decorators';

/**
 * One auth surface for all three kinds of account — v2 keeps them in one
 * `users` table, so there is no reason for three sets of endpoints.
 *
 * Throttle limits are per IP and deliberately tight on anything that either
 * costs a hash or sends a message.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * A flood guard, not the brute-force defence — that is `login_attempts`,
   * which locks a single account after `login_max_attempts` failures.
   *
   * The limit must sit **above** that setting, or the throttle fires first and
   * the account lockout is never reached. It is also per IP, and a guesthouse
   * office behind one NAT signs several staff in at once, so a handful per
   * minute is too tight to be usable.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @ClientIp() ip: string, @UserAgent() ua: string | null) {
    return this.auth.login(dto, ip, ua);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  registerCustomer(
    @Body() dto: RegisterCustomerDto,
    @ClientIp() ip: string,
    @UserAgent() ua: string | null,
  ) {
    return this.auth.registerCustomer(dto, ip, ua);
  }

  /** Open registration: it creates a `pending` application, not a live account. */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('register/partner')
  registerPartner(
    @Body() dto: RegisterPartnerDto,
    @ClientIp() ip: string,
    @UserAgent() ua: string | null,
  ) {
    return this.auth.registerPartner(dto, ip, ua);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @ClientIp() ip: string, @UserAgent() ua: string | null) {
    return this.auth.refresh(dto.refreshToken, ip, ua);
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: AuthedUser) {
    return this.auth.me(user.userId);
  }

  // ── OTP ───────────────────────────────────────────────────────────────────

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(200)
  @Post('otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.target, dto.purpose);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.target, dto.purpose, dto.code);
  }

  // ── password ──────────────────────────────────────────────────────────────

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(200)
  @Post('password/forgot')
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('password/reset')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Patch('password')
  changePassword(@CurrentUser() user: AuthedUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.userId, dto.currentPassword, dto.newPassword);
  }
}
