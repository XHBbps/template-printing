/* eslint-disable import/no-unresolved */
import {
  Body,
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
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { z } from 'zod';
/* eslint-enable import/no-unresolved */

// eslint-disable-next-line import/no-unresolved
import { AuditLogService } from '../../audit/audit-log.service.js';
// eslint-disable-next-line import/no-unresolved
import { Public } from '../decorators/public.decorator.js';
// eslint-disable-next-line import/no-unresolved
import { setAuthCookies, type CookieEnv } from '../jwt/jwt-cookie.helper.js';
// eslint-disable-next-line import/no-unresolved
import { JwtAuthService } from '../jwt/jwt.service.js';
// eslint-disable-next-line import/no-unresolved
import { RefreshTokenService } from '../jwt/refresh-token.service.js';

const LoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  remember: z.boolean().optional().default(true),
});

@Controller('auth/local')
export class LocalController {
  constructor(
    private readonly jwt: JwtAuthService,
    private readonly refresh: RefreshTokenService,
    private readonly prisma: PrismaClient,
    private readonly audit: AuditLogService,
    @Inject('COOKIE_ENV') private readonly cookieEnv: CookieEnv,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() raw: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true; csrf: string; mustChangePassword: boolean }> {
    const body = LoginBodySchema.parse(raw);
    const user = await this.prisma.user.findUnique({ where: { localUsername: body.username } });
    if (!user || !user.localPasswordHash) {
      throw new UnauthorizedException('Invalid username or password');
    }
    if (user.disabledAt) throw new UnauthorizedException('account_disabled');
    const valid = await bcrypt.compare(body.password, user.localPasswordHash);
    if (!valid) throw new UnauthorizedException('Invalid username or password');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { token: access, csrf } = this.jwt.sign({
      sub: user.id,
      role: user.role as 'admin' | 'user' | 'emergency_admin',
    });
    const { plaintext: refreshTok } = await this.refresh.create(user.id);
    setAuthCookies(
      res,
      this.cookieEnv,
      { access, refresh: refreshTok },
      { remember: body.remember },
    );

    void this.audit.log({
      actor: { id: user.id, name: user.name },
      action: 'user.login.local',
      resourceType: 'user',
      resourceId: user.id,
      request: req,
    });

    return { ok: true, csrf, mustChangePassword: user.mustChangePassword };
  }
}
