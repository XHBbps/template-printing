import { describe, it, expect } from '@jest/globals';
import type { Request } from 'express';

// eslint-disable-next-line import/no-unresolved
import { ACCESS_COOKIE } from '../src/auth/jwt/jwt-cookie.helper.js';
// eslint-disable-next-line import/no-unresolved
import { UserThrottlerGuard } from '../src/common/user-throttler.guard.js';

// 暴露 protected getTracker 供单测;构造器 3 参在 getTracker 内未使用,传桩即可。
class ExposedGuard extends UserThrottlerGuard {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super({} as any, {} as any, {} as any);
  }
  track(req: Partial<Request>): Promise<string> {
    return this.getTracker(req as Request);
  }
}

describe('UserThrottlerGuard.getTracker — per-user/per-credential 分桶', () => {
  const guard = new ExposedGuard();

  it('已注入 req.user → user:<sub>(非 render 路由)', async () => {
    const key = await guard.track({
      user: { sub: 'u-1', role: 'user', csrf: '' },
    } as Partial<Request>);
    expect(key).toBe('user:u-1');
  });

  it('Bearer token 路径 → 同 token 同桶、不同 token 不同桶(不依赖 IP)', async () => {
    const reqA1 = {
      headers: { authorization: 'Bearer tpkn_AAA' },
      ip: '1.1.1.1',
    } as Partial<Request>;
    const reqA2 = {
      headers: { authorization: 'Bearer tpkn_AAA' },
      ip: '2.2.2.2',
    } as Partial<Request>;
    const reqB = {
      headers: { authorization: 'Bearer tpkn_BBB' },
      ip: '1.1.1.1',
    } as Partial<Request>;
    const kA1 = await guard.track(reqA1);
    const kA2 = await guard.track(reqA2);
    const kB = await guard.track(reqB);
    // 同一 user(同 token)不同 IP → 同桶
    expect(kA1).toBe(kA2);
    expect(kA1.startsWith('token:')).toBe(true);
    // 不同 user(不同 token)同 IP → 不同桶
    expect(kA1).not.toBe(kB);
    // 不落明文 secret
    expect(kA1).not.toContain('tpkn_AAA');
  });

  it('cookie 会话路径 → 同会话同桶、不同会话不同桶', async () => {
    const reqA = {
      headers: {},
      cookies: { [ACCESS_COOKIE]: 'jwtA' },
      ip: '1.1.1.1',
    } as Partial<Request>;
    const reqB = {
      headers: {},
      cookies: { [ACCESS_COOKIE]: 'jwtB' },
      ip: '1.1.1.1',
    } as Partial<Request>;
    const kA = await guard.track(reqA);
    const kB = await guard.track(reqB);
    expect(kA).toBe(await guard.track(reqA));
    expect(kA).not.toBe(kB);
    expect(kA.startsWith('sess:')).toBe(true);
    expect(kA).not.toContain('jwtA');
  });

  it('无凭证 → ip fallback', async () => {
    const key = await guard.track({ headers: {}, ip: '9.9.9.9' } as Partial<Request>);
    expect(key).toBe('ip:9.9.9.9');
  });
});
