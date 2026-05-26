import type { Response, CookieOptions } from 'express';

export const ACCESS_COOKIE = 'tp_access';
export const REFRESH_COOKIE = 'tp_refresh';
export const REMEMBER_COOKIE = 'tp_remember';

export interface CookieEnv {
  nodeEnv: string;
  cookieDomain: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

function baseOptions(env: CookieEnv): CookieOptions {
  const isProd = env.nodeEnv === 'production';
  return {
    httpOnly: true,
    // SameSite=None+Secure required for Lark webview iframe; in dev we still
    // set Secure=false because http://localhost serves cookies fine without TLS.
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
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
