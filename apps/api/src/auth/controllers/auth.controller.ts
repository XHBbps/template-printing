/* eslint-disable import/no-unresolved */
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
/* eslint-enable import/no-unresolved */
import type { Request, Response } from 'express';

// eslint-disable-next-line import/no-unresolved
import { AuditLogService } from '../../audit/audit-log.service.js';
// eslint-disable-next-line import/no-unresolved
import { Public } from '../decorators/public.decorator.js';
/* eslint-disable import/no-unresolved */
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  setAuthCookies,
  type CookieEnv,
} from '../jwt/jwt-cookie.helper.js';
/* eslint-enable import/no-unresolved */
// eslint-disable-next-line import/no-unresolved
import { JwtAuthService } from '../jwt/jwt.service.js';
// eslint-disable-next-line import/no-unresolved
import { RefreshTokenService } from '../jwt/refresh-token.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly jwt: JwtAuthService,
    private readonly refresh: RefreshTokenService,
    private readonly prisma: PrismaClient,
    private readonly audit: AuditLogService,
    @Inject('COOKIE_ENV') private readonly cookieEnv: CookieEnv,
  ) {}

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    // Idempotent: always clear cookies even if access token expired or absent.
    // Otherwise an expired-token user can't actually logout — the JwtAuthGuard
    // returns 401 before clearAuthCookies runs, leaving cookies stale.
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const refreshToken = cookies[REFRESH_COOKIE];
    let actorId: string | null = null;
    if (refreshToken) {
      try {
        const v = await this.refresh.verify(refreshToken);
        if (v) {
          actorId = v.userId;
          await this.refresh.revoke(v.id);
        }
      } catch {
        // Refresh token invalid / expired / tampered — still clear cookies.
      }
    }
    clearAuthCookies(res, this.cookieEnv);

    if (actorId) {
      const user = await this.prisma.user.findUnique({ where: { id: actorId } });
      void this.audit.log({
        actor: { id: actorId, name: user?.name ?? null },
        action: 'user.logout',
        resourceType: 'user',
        resourceId: actorId,
        request: req,
      });
    }
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
