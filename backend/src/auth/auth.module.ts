import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PartnerAuthController } from './partner-auth.controller';
import { CustomerAuthController } from './customer-auth.controller';
import { AdminJwtStrategy } from './strategies/admin.strategy';
import { PartnerJwtStrategy } from './strategies/partner.strategy';
import { UserJwtStrategy } from './strategies/user.strategy';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({})],
  controllers: [AuthController, PartnerAuthController, CustomerAuthController],
  providers: [AuthService, AdminJwtStrategy, PartnerJwtStrategy, UserJwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
