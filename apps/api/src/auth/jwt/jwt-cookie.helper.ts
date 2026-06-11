import type { Response, CookieOptions } from 'express';

export const ACCESS_COOKIE = 'tp_access';
export const REFRESH_COOKIE = 'tp_refresh';
export const REMEMBER_COOKIE = 'tp_remember';

export interface CookieEnv {
  /** 部署形态是否 https(由 LARK_SSO_REDIRECT_URI 协议判定,见 auth.module)。 */
  secure: boolean;
  cookieDomain: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

function baseOptions(env: CookieEnv): CookieOptions {
  return {
    httpOnly: true,
    // https 部署:SameSite=None+Secure(飞书 webview iframe 需要)。
    // http 部署(内网 ip / 平台分配端口,无证书):必须省略 Secure —— 浏览器对 http 拒存
    // Secure cookie,且 SameSite=None 强制 Secure(死锁);Lax 对登录流足够。
    // 不能按 NODE_ENV 判定:生产也可能跑在 http(如灯塔内网部署),故按部署 URL 协议自适应。
    sameSite: env.secure ? 'none' : 'lax',
    secure: env.secure,
    path: '/',
    domain: env.cookieDomain || undefined,
  };
}

export function setAuthCookies(
  res: Response,
  env: CookieEnv,
  tokens: { access: string; refresh: string },
  options: { remember?: boolean } = {},
): void {
  // remember=true(默认)→ 持久 cookie(带 maxAge);false → session cookie(关浏览器即失效)。
  const remember = options.remember ?? true;
  res.cookie(ACCESS_COOKIE, tokens.access, {
    ...baseOptions(env),
    ...(remember ? { maxAge: env.accessTtlSeconds * 1000 } : {}),
  });
  res.cookie(REFRESH_COOKIE, tokens.refresh, {
    ...baseOptions(env),
    ...(remember ? { maxAge: env.refreshTtlSeconds * 1000 } : {}),
  });
  // 记录 remember 选择,供 /auth/refresh 续签时延续相同语义。
  res.cookie(REMEMBER_COOKIE, remember ? '1' : '0', {
    ...baseOptions(env),
    ...(remember ? { maxAge: env.refreshTtlSeconds * 1000 } : {}),
  });
}

export function clearAuthCookies(res: Response, env: CookieEnv): void {
  res.clearCookie(ACCESS_COOKIE, baseOptions(env));
  res.clearCookie(REFRESH_COOKIE, baseOptions(env));
  res.clearCookie(REMEMBER_COOKIE, baseOptions(env));
}
