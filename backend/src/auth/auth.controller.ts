import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, RegisterAdminDto, RefreshDto } from './dto/auth.dto';
import { Public, CurrentAdmin, ClientIp, type AuthedAdmin } from '../common/decorators';
import { ROLE_LABEL } from '../common/roles';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 5 attempts per minute per IP — enough for a typo, not for brute force. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('admin/login')
  login(@Body() dto: LoginDto, @ClientIp() ip: string) {
    return this.auth.login(dto, ip);
  }

  /** Only works while the admins table is empty (bootstraps the first account). */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('admin/register')
  register(@Body() dto: RegisterAdminDto, @ClientIp() ip: string) {
    return this.auth.register(dto, ip);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @ClientIp() ip: string) {
    return this.auth.refresh(dto.refreshToken, ip);
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  me(@CurrentAdmin() admin: AuthedAdmin) {
    return {
      id: admin.id.toString(),
      email: admin.email,
      name: admin.name,
      role: admin.role,
      roleLabel: ROLE_LABEL[admin.role],
    };
  }
}
