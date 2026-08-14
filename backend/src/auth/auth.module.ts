import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { PasswordService } from './password.service';
import { LoginGuardService } from './login-guard.service';
import { AgreementsService } from './agreements.service';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PasswordService, LoginGuardService, AgreementsService],
  // PasswordService is exported because the admin module creates staff accounts.
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
