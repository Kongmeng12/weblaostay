import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, RegisterCustomerDto } from './dto/auth.dto';
import {
  Public,
  Actor,
  CurrentUser,
  ClientIp,
  type AuthedUser,
} from '../common/decorators';
import { ACTOR } from '../common/actors';

@Controller('auth/customer')
@Actor(ACTOR.USER)
export class CustomerAuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @ClientIp() ip: string) {
    return this.auth.customerLogin(dto, ip);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterCustomerDto, @ClientIp() ip: string) {
    return this.auth.customerRegister(dto, ip);
  }

  @Get('me')
  me(@CurrentUser() user: AuthedUser) {
    return {
      id: user.id.toString(),
      email: user.email,
      fullName: user.fullName,
      status: user.status,
    };
  }
}
