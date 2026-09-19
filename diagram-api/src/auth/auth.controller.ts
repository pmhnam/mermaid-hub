import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  Query,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { REFRESH_COOKIE } from './auth.constants.js';
import type { AuthenticatedUser, SessionMetadata } from './auth.types.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { LocalAuthGuard } from './guards/local-auth.guard.js';
import {
  GoogleAuthService,
  GOOGLE_ATTEMPT_COOKIE,
  GOOGLE_COOKIE_PATH,
} from './google-auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    private readonly google: GoogleAuthService,
  ) {}

  @Get('providers')
  providers() {
    return { google: this.google.enabled };
  }

  @Get('google')
  async googleStart(@Res() response: Response) {
    const attempt = await this.google.begin();
    response.setHeader('Cache-Control', 'no-store');
    response.cookie(GOOGLE_ATTEMPT_COOKIE, attempt.cookie, {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE', 'false') === 'true',
      sameSite: 'lax',
      path: GOOGLE_COOKIE_PATH,
      maxAge: 600_000,
    });
    response.redirect(attempt.url);
  }

  @Get('google/callback')
  async googleCallback(
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    if (!this.google.enabled)
      throw new ServiceUnavailableException('Google sign-in is not configured');
    response.setHeader('Cache-Control', 'no-store');
    response.clearCookie(GOOGLE_ATTEMPT_COOKIE, { path: GOOGLE_COOKIE_PATH });
    try {
      const identity = await this.google.complete(
        query.code,
        query.state,
        request.cookies?.[GOOGLE_ATTEMPT_COOKIE],
      );
      const result = await this.authService.loginWithGoogle(
        identity,
        this.metadata(request),
      );
      this.setRefreshCookie(response, result.refreshToken);
      response.redirect(this.google.resultUrl('success'));
    } catch (error) {
      const reason =
        error instanceof ConflictException
          ? 'account_exists'
          : query.error === 'access_denied'
            ? 'cancelled'
            : 'failed';
      response.redirect(this.google.resultUrl(reason));
    }
  }

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.register(dto, this.metadata(request));
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @UseGuards(LocalAuthGuard)
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() _dto: LoginDto,
    @Req() request: Request & { user: AuthenticatedUser },
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.issueTokens(
      request.user,
      this.metadata(request),
    );
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.refresh(
      request.cookies?.[REFRESH_COOKIE] as string | undefined,
      this.metadata(request),
    );
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @HttpCode(204)
  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(
      request.cookies?.[REFRESH_COOKIE] as string | undefined,
    );
    response.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  private setRefreshCookie(response: Response, token: string): void {
    response.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE', 'false') === 'true',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge:
        this.config.get<number>('REFRESH_TOKEN_TTL_DAYS', 30) * 86_400_000,
    });
  }

  private metadata(request: Request): SessionMetadata {
    return {
      ipAddress: request.ip || null,
      userAgent: request.get('user-agent')?.slice(0, 512) ?? null,
    };
  }
}
