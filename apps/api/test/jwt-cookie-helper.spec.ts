import { describe, it, expect } from '@jest/globals';

/* eslint-disable import/no-unresolved */
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REMEMBER_COOKIE,
  setAuthCookies,
  clearAuthCookies,
  type CookieEnv,
} from '../src/auth/jwt/jwt-cookie.helper.js';
/* eslint-enable import/no-unresolved */

type CookieCall = { name: string; value: string; opts: Record<string, unknown> };

function fakeRes() {
  const set: CookieCall[] = [];
  const cleared: CookieCall[] = [];
  const res = {
    set,
    cleared,
    cookie(name: string, value: string, opts: Record<string, unknown>) {
      set.push({ name, value, opts });
    },
    clearCookie(name: string, opts: Record<string, unknown>) {
      cleared.push({ name, value: '', opts });
    },
  };
  return res;
}

const ENV: CookieEnv = {
  nodeEnv: 'test',
  cookieDomain: '',
  accessTtlSeconds: 86400,
  refreshTtlSeconds: 2592000,
};

describe('jwt-cookie.helper remember semantics', () => {
  it('remember=true sets maxAge on all three cookies', () => {
    const res = fakeRes();
    setAuthCookies(res as never, ENV, { access: 'a', refresh: 'r' }, { remember: true });
    const byName = Object.fromEntries(res.set.map((c) => [c.name, c]));
    expect(byName[ACCESS_COOKIE].opts.maxAge).toBe(86400 * 1000);
    expect(byName[REFRESH_COOKIE].opts.maxAge).toBe(2592000 * 1000);
    expect(byName[REMEMBER_COOKIE].opts.maxAge).toBe(2592000 * 1000);
    expect(byName[REMEMBER_COOKIE].value).toBe('1');
  });

  it('remember=false omits maxAge (session cookies) and writes 0', () => {
    const res = fakeRes();
    setAuthCookies(res as never, ENV, { access: 'a', refresh: 'r' }, { remember: false });
    const byName = Object.fromEntries(res.set.map((c) => [c.name, c]));
    expect(byName[ACCESS_COOKIE].opts.maxAge).toBeUndefined();
    expect(byName[REFRESH_COOKIE].opts.maxAge).toBeUndefined();
    expect(byName[REMEMBER_COOKIE].opts.maxAge).toBeUndefined();
    expect(byName[REMEMBER_COOKIE].value).toBe('0');
  });

  it('defaults to remember=true when options omitted', () => {
    const res = fakeRes();
    setAuthCookies(res as never, ENV, { access: 'a', refresh: 'r' });
    const byName = Object.fromEntries(res.set.map((c) => [c.name, c]));
    expect(byName[REFRESH_COOKIE].opts.maxAge).toBe(2592000 * 1000);
  });

  it('clearAuthCookies clears all three including tp_remember', () => {
    const res = fakeRes();
    clearAuthCookies(res as never, ENV);
    const names = res.cleared.map((c) => c.name);
    expect(names).toContain(ACCESS_COOKIE);
    expect(names).toContain(REFRESH_COOKIE);
    expect(names).toContain(REMEMBER_COOKIE);
  });
});
