import { createHash } from 'node:crypto';

// eslint-disable-next-line import/no-unresolved
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

// eslint-disable-next-line import/no-unresolved
import { ACCESS_COOKIE } from '../auth/jwt/jwt-cookie.helper.js';
import type { JwtClaims } from '../auth/jwt/jwt.service.js';

/** 取凭证指纹(sha256 前缀)作为限流分桶 key,绝不落明文 secret 到限流存储。 */
function fingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 32);
}

/**
 * Throttler 自定义 tracker：按调用方身份分桶（per-user / per-credential），而非全站共享 IP 桶。
 *
 * 注意执行顺序：全局 throttler 早于 **controller 级** guard 执行。对 `/api/render` 这类
 * `@Public()` + `@UseGuards(ApiAuthGuard)` 的路由，ApiAuthGuard 尚未注入 `req.user`，
 * 若只看 `req.user` 会全部落到 IP fallback → per-user 限流退化为全站共享单桶（互相误伤）。
 * 故此处对无 `req.user` 的请求自行按凭证分桶（只取指纹，不验签 / 不反查 DB / 不落明文）。
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Request): Promise<string> {
    // 1) 已鉴权路由：全局 JwtAuthGuard 早于本 guard 注入 req.user → 直接 per-user。
    const user = (req as Request & { user?: JwtClaims }).user;
    if (user?.sub) return `user:${user.sub}`;

    // 2) @Public + controller 级 ApiAuthGuard 的路由（如 /api/render）：此刻 req.user 必为
    //    undefined，按凭证指纹分桶。同一 Bearer token / 同一会话 cookie = 同一桶（= 同一用户），
    //    不同用户凭证不同 → 不同桶，per-user 维度恢复。
    const auth = (req.headers['authorization'] ?? req.headers['Authorization']) as
      | string
      | undefined;
    if (auth?.startsWith('Bearer tpkn_')) {
      return `token:${fingerprint(auth.slice('Bearer '.length))}`;
    }
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const cookieToken = cookies[ACCESS_COOKIE];
    if (cookieToken) return `sess:${fingerprint(cookieToken)}`;

    // 3) 无凭证（ApiAuthGuard 随后会拒）→ IP fallback（需 trust proxy 才取到真实客户端 IP）。
    return `ip:${req.ip ?? 'unknown'}`;
  }
}
