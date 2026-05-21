import { randomBytes } from 'node:crypto';

import { BadRequestException, Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';

// eslint-disable-next-line import/no-unresolved
import { Public } from '../decorators/public.decorator.js';
// eslint-disable-next-line import/no-unresolved
import {
  setAuthCookies,
  type CookieEnv,
  // eslint-disable-next-line import/no-unresolved
} from '../jwt/jwt-cookie.helper.js';
// eslint-disable-next-line import/no-unresolved
import { JwtAuthService } from '../jwt/jwt.service.js';
// eslint-disable-next-line import/no-unresolved
import { RefreshTokenService } from '../jwt/refresh-token.service.js';

// eslint-disable-next-line import/no-unresolved
import { LarkService } from './lark.service.js';

export const STATE_COOKIE = 'tp_lark_state';
export const CONTINUE_COOKIE = 'tp_lark_continue';
const STATE_TTL_SECONDS = 300;

export interface LarkConfig {
  redirectUri: string;
  nodeEnv: string;
  initialAdminLarkUserIds: string[];
  cookieEnv: CookieEnv;
}

@Controller('auth/lark')
export class LarkController {
  constructor(
    private readonly lark: LarkService,
    private readonly jwt: JwtAuthService,
    private readonly refresh: RefreshTokenService,
    private readonly prisma: PrismaClient,
    @Inject('LARK_CONFIG') private readonly cfg: LarkConfig,
  ) {}

  @Public()
  @Get('login')
  login(
    @Query('continue') continueTo: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): void {
    const state = randomBytes(32).toString('hex');
    const safeContinue = sanitizeContinue(continueTo);
    const cookieOpts = {
      httpOnly: true,
      sameSite: this.cfg.nodeEnv === 'production' ? ('none' as const) : ('lax' as const),
      secure: this.cfg.nodeEnv === 'production',
      maxAge: STATE_TTL_SECONDS * 1000,
      path: '/auth/lark/callback',
    };
    res.cookie(STATE_COOKIE, state, cookieOpts);
    if (safeContinue) res.cookie(CONTINUE_COOKIE, safeContinue, cookieOpts);

    const url = this.lark.buildAuthorizeUrl({ redirectUri: this.cfg.redirectUri, state });
    res.redirect(302, url);
  }

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') stateParam: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (!code || !stateParam) {
      throw new BadRequestException('Missing code or state');
    }

    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const stateCookie = cookies[STATE_COOKIE];
    if (!stateCookie || stateCookie !== stateParam) {
      throw new BadRequestException('Invalid OAuth state');
    }
    const continueTo = cookies[CONTINUE_COOKIE] ?? '/';

    const clearOpts = { path: '/auth/lark/callback' };
    res.clearCookie(STATE_COOKIE, clearOpts);
    res.clearCookie(CONTINUE_COOKIE, clearOpts);

    const tokenResp = await this.lark.exchangeCode({
      code,
      redirectUri: this.cfg.redirectUri,
    });
    const info = await this.lark.fetchUserInfo(tokenResp.access_token);

    const shouldBeAdmin = this.cfg.initialAdminLarkUserIds.includes(info.user_id);
    const user = await this.prisma.user.upsert({
      where: { larkOpenId: info.open_id },
      update: {
        larkUnionId: info.union_id,
        larkUserId: info.user_id,
        name: info.name,
        email: info.email ?? null,
        avatarUrl: info.avatar_url,
        lastLoginAt: new Date(),
      },
      create: {
        larkOpenId: info.open_id,
        larkUnionId: info.union_id,
        larkUserId: info.user_id,
        name: info.name,
        email: info.email ?? null,
        avatarUrl: info.avatar_url,
        role: shouldBeAdmin ? 'admin' : 'user',
        lastLoginAt: new Date(),
      },
    });

    const { token: access, csrf } = this.jwt.sign({
      sub: user.id,
      role: user.role as 'admin' | 'user' | 'emergency_admin',
    });
    const { plaintext: refresh } = await this.refresh.create(user.id);

    setAuthCookies(res, this.cfg.cookieEnv, { access, refresh });

    const finalUrl = appendQuery(continueTo, { csrf });
    res.redirect(302, finalUrl);
  }
}

function sanitizeContinue(input: string | undefined): string | null {
  if (!input) return null;
  if (!input.startsWith('/')) return null;
  if (input.startsWith('//')) return null;
  if (input.length > 256) return null;
  return input;
}

function appendQuery(path: string, params: Record<string, string>): string {
  const [base, query = ''] = path.split('?');
  const sp = new URLSearchParams(query);
  for (const [k, v] of Object.entries(params)) sp.set(k, v);
  return `${base}?${sp.toString()}`;
}
