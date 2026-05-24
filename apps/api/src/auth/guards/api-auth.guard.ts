import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { ApiTokenService } from '../api-token/api-token.service.js';
// eslint-disable-next-line import/no-unresolved
import type { AuthenticatedRequest } from '../decorators/current-user.decorator.js';
// eslint-disable-next-line import/no-unresolved
import { ACCESS_COOKIE } from '../jwt/jwt-cookie.helper.js';
// eslint-disable-next-line import/no-unresolved
import { JwtAuthService } from '../jwt/jwt.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 双栈鉴权：
 *   Path 1 — `Authorization: Bearer tpkn_<...>` 优先（外部脚本 / 集成）
 *   Path 2 — JWT cookie + CSRF token（浏览器 / 设计器）
 *
 * 二者择一通过则放行；都没有则 401。
 * 用法：路由用 @Public() 跳过全局 JwtAuthGuard + CsrfGuard，然后
 * @UseGuards(ApiAuthGuard) 显式跑这个。
 */
@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: ApiTokenService,
    private readonly jwt: JwtAuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = (req.headers['authorization'] ?? req.headers['Authorization']) as
      | string
      | undefined;

    // ----- Path 1: Bearer API token -----
    if (auth?.startsWith('Bearer tpkn_')) {
      const plaintext = auth.slice('Bearer '.length);
      const user = await this.tokens.verify(plaintext);
      if (!user) throw new UnauthorizedException('invalid_or_revoked_token');
      // 兼容 JwtClaims 形态（csrf 无需 — token 自身是凭证）
      req.user = {
        sub: user.id,
        role: user.role as 'emergency_admin' | 'user' | 'admin',
        csrf: '',
      };
      return true;
    }

    // ----- Path 2: JWT cookie + CSRF -----
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies ?? {};
    const cookieToken = cookies[ACCESS_COOKIE];
    if (!cookieToken) {
      throw new UnauthorizedException('No credentials (need Bearer token or login cookie)');
    }
    try {
      req.user = this.jwt.verify(cookieToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // CSRF double-submit for unsafe methods on cookie path
    if (!SAFE_METHODS.has(req.method)) {
      const headerToken = (req.headers['x-csrf-token'] ?? req.headers['X-CSRF-Token']) as
        | string
        | undefined;
      const expected = req.user?.csrf;
      if (!expected || !headerToken || headerToken !== expected) {
        throw new ForbiddenException('CSRF token missing or invalid');
      }
    }

    return true;
  }
}
