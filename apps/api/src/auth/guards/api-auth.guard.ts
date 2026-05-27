import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { isExternal } from '../account-kind.js';
// eslint-disable-next-line import/no-unresolved
import { ApiTokenService } from '../api-token/api-token.service.js';
// eslint-disable-next-line import/no-unresolved
import type { AuthenticatedRequest } from '../decorators/current-user.decorator.js';
// eslint-disable-next-line import/no-unresolved
import { ACCESS_COOKIE } from '../jwt/jwt-cookie.helper.js';
// eslint-disable-next-line import/no-unresolved
import { JwtAuthService } from '../jwt/jwt.service.js';
// eslint-disable-next-line import/no-unresolved
import { UserStateService } from '../user-state.service.js';

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
    private readonly userState: UserStateService,
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
      if (isExternal(user)) throw new ForbiddenException('external_account_forbidden');
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
    let claims;
    try {
      claims = this.jwt.verify(cookieToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    const state = await this.userState.get(claims.sub);
    if (!state || state.disabledAt) {
      throw new UnauthorizedException('account_disabled_or_missing');
    }
    req.user = { ...claims, role: state.role };

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
