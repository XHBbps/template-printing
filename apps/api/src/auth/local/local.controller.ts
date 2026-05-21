import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { Response } from 'express';
import { z } from 'zod';

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
});

@Controller('auth/local')
export class LocalController {
  constructor(
    private readonly jwt: JwtAuthService,
    private readonly refresh: RefreshTokenService,
    private readonly prisma: PrismaClient,
    @Inject('COOKIE_ENV') private readonly cookieEnv: CookieEnv,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true; csrf: string; mustChangePassword: boolean }> {
    const body = LoginBodySchema.parse(raw);
    const user = await this.prisma.user.findUnique({ where: { localUsername: body.username } });
    if (!user || !user.localPasswordHash || user.role !== 'emergency_admin') {
      throw new UnauthorizedException('Invalid username or password');
    }
    const valid = await bcrypt.compare(body.password, user.localPasswordHash);
    if (!valid) throw new UnauthorizedException('Invalid username or password');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { token: access, csrf } = this.jwt.sign({ sub: user.id, role: 'emergency_admin' });
    const { plaintext: refreshTok } = await this.refresh.create(user.id);
    setAuthCookies(res, this.cookieEnv, { access, refresh: refreshTok });

    return { ok: true, csrf, mustChangePassword: user.mustChangePassword };
  }
}
