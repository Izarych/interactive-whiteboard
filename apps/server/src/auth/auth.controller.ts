import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { ChallengeDto, EmailDto, LoginDto, RegisterDto, ResetPasswordDto, UpdateProfileDto, VerifyEmailDto } from './auth.dto';
import type { AuthenticatedRequest } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('session')
  session(@Req() request: Request) { return this.auth.session(request); }

  @Post('guest')
  @HttpCode(200)
  guest(@Req() request: Request, @Res({ passthrough: true }) response: Response) { return this.auth.guest(request, response); }

  @Post('register')
  @UseGuards(AuthGuard)
  register(@Req() request: AuthenticatedRequest, @Body() dto: RegisterDto) { return this.auth.register(request.auth, dto, request.ip ?? ''); }

  @Post('register/resend')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  resend(@Req() request: AuthenticatedRequest, @Body() dto: ChallengeDto) { return this.auth.resend(request.auth, dto.challengeId, request.ip ?? ''); }

  @Post('verify-email')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  verify(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response, @Body() dto: VerifyEmailDto) {
    return this.auth.verify(request.auth, dto, response, request.ip ?? '');
  }

  @Post('login')
  @HttpCode(200)
  login(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() dto: LoginDto) {
    return this.auth.login(request, response, dto.email, dto.password);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) { return this.auth.logout(request, response); }

  @Post('admin/login')
  @HttpCode(200)
  adminLogin(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() dto: LoginDto) {
    return this.auth.login(request, response, dto.email, dto.password, true);
  }

  @Post('forgot-password')
  @HttpCode(200)
  forgot(@Req() request: Request, @Body() dto: EmailDto) { return this.auth.forgot(dto.email, request.ip ?? ''); }

  @Post('reset-password')
  @HttpCode(204)
  reset(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() dto: ResetPasswordDto) { return this.auth.reset(dto, request, response); }

  @Patch('profile')
  @UseGuards(AuthGuard)
  profile(@Req() request: AuthenticatedRequest, @Body() dto: UpdateProfileDto) { return this.auth.updateProfile(request.auth, dto); }
}
