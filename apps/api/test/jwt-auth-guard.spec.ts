import { describe, it, expect, beforeEach } from '@jest/globals';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// eslint-disable-next-line import/no-unresolved
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard.js';
// eslint-disable-next-line import/no-unresolved
import { ACCESS_COOKIE } from '../src/auth/jwt/jwt-cookie.helper.js';
// eslint-disable-next-line import/no-unresolved
import { JwtAuthService } from '../src/auth/jwt/jwt.service.js';

describe('JwtAuthGuard', () => {
  const reflector = new Reflector();
  const jwt = new JwtAuthService('a'.repeat(32), 60);
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard(reflector, jwt);
  });

  function mockCtx(cookies: Record<string, string> = {}): ExecutionContext {
    const req: Record<string, unknown> = { cookies };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('allows public endpoints without a cookie', () => {
    const saveGet = reflector.getAllAndOverride;
    reflector.getAllAndOverride = (() => true) as typeof saveGet;
    expect(guard.canActivate(mockCtx())).toBe(true);
    reflector.getAllAndOverride = saveGet;
  });

  it('rejects when no access cookie', () => {
    expect(() => guard.canActivate(mockCtx())).toThrow(UnauthorizedException);
  });

  it('attaches user when cookie is valid', () => {
    const { token } = jwt.sign({ sub: 'u-1', role: 'admin' });
    const ctx = mockCtx({ [ACCESS_COOKIE]: token });
    expect(guard.canActivate(ctx)).toBe(true);
    const req = ctx.switchToHttp().getRequest() as { user?: { sub: string } };
    expect(req.user?.sub).toBe('u-1');
  });

  it('rejects invalid token', () => {
    const ctx = mockCtx({ [ACCESS_COOKIE]: 'garbage' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
