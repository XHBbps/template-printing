import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';

// eslint-disable-next-line import/no-unresolved
import { CurrentUser } from '../decorators/current-user.decorator.js';
// eslint-disable-next-line import/no-unresolved
import { Public } from '../decorators/public.decorator.js';
// eslint-disable-next-line import/no-unresolved
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  setAuthCookies,
  type CookieEnv,
} from '../jwt/jwt-cookie.helper.js';
// eslint-disable-next-line import/no-unresolved
import { JwtAuthService, type JwtClaims } from '../jwt/jwt.service.js';
// eslint-disable-next-line import/no-unresolved
import { RefreshTokenService } from '../jwt/refresh-token.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly jwt: JwtAuthService,
    private readonly refresh: RefreshTokenService,
    private readonly prisma: PrismaClient,
    @Inject('COOKIE_ENV') private readonly cookieEnv: CookieEnv,
  ) {}

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: JwtClaims,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const refreshToken = cookies[REFRESH_COOKIE];
    if (refreshToken) {
      const v = await this.refresh.verify(refreshToken);
      if (v && v.userId === user.sub) {
        await this.refresh.revoke(v.id);
      }
    }
    clearAuthCookies(res, this.cookieEnv);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh_(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true; csrf: string }> {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const refreshToken = cookies[REFRESH_COOKIE];
    if (!refreshToken) throw new UnauthorizedException('No refresh token');

    const v = await this.refresh.verify(refreshToken);
    if (!v) throw new UnauthorizedException('Invalid or expired refresh token');

    const user = await this.prisma.user.findUnique({ where: { id: v.userId } });
    if (!user) throw new UnauthorizedException('User no longer exists');

    await this.refresh.revoke(v.id);
    const { plaintext: newRefresh } = await this.refresh.create(user.id);
    const { token: newAccess, csrf } = this.jwt.sign({
      sub: user.id,
      role: user.role as 'admin' | 'user' | 'emergency_admin',
    });
    setAuthCookies(res, this.cookieEnv, { access: newAccess, refresh: newRefresh });
    return { ok: true, csrf };
  }
}
