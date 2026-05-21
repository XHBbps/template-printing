import { randomBytes } from 'node:crypto';

import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

// eslint-disable-next-line import/no-unresolved
import { Public } from '../decorators/public.decorator.js';

// eslint-disable-next-line import/no-unresolved
import { LarkService } from './lark.service.js';

export const STATE_COOKIE = 'tp_lark_state';
export const CONTINUE_COOKIE = 'tp_lark_continue';
const STATE_TTL_SECONDS = 300;

@Controller('auth/lark')
export class LarkController {
  constructor(
    private readonly lark: LarkService,
    @Inject('LARK_CONFIG')
    private readonly cfg: { redirectUri: string; nodeEnv: string },
  ) {}

  @Public()
  @Get('login')
  login(
    @Query('continue') continueTo: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): void {
    const state = randomBytes(32).toString('hex');
    const safeContinue = sanitizeContinue(continueTo);

    const isProd = this.cfg.nodeEnv === 'production';
    const cookieOpts = {
      httpOnly: true,
      sameSite: isProd ? ('none' as const) : ('lax' as const),
      secure: isProd,
      maxAge: STATE_TTL_SECONDS * 1000,
      path: '/auth/lark/callback',
    };
    res.cookie(STATE_COOKIE, state, cookieOpts);
    if (safeContinue) res.cookie(CONTINUE_COOKIE, safeContinue, cookieOpts);

    const url = this.lark.buildAuthorizeUrl({ redirectUri: this.cfg.redirectUri, state });
    res.redirect(302, url);
  }
}

function sanitizeContinue(input: string | undefined): string | null {
  if (!input) return null;
  if (!input.startsWith('/')) return null;
  if (input.startsWith('//')) return null;
  if (input.length > 256) return null;
  return input;
}
