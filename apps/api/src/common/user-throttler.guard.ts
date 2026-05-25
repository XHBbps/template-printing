// eslint-disable-next-line import/no-unresolved
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

import type { JwtClaims } from '../auth/jwt/jwt.service.js';

/**
 * Throttler 自定义 tracker：优先用 user.sub（API token 或 cookie 鉴权后注入），
 * 其次 IP。这样 2000 人用同一 API token 不会互相影响其他人的限流额度。
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Request): Promise<string> {
    const user = (req as Request & { user?: JwtClaims }).user;
    if (user?.sub) return `user:${user.sub}`;
    // fallback：trust express's req.ip (with trust proxy 配合)
    return `ip:${req.ip ?? 'unknown'}`;
  }
}
