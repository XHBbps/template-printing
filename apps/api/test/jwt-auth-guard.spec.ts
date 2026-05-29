import { describe, it, expect, beforeEach } from '@jest/globals';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// eslint-disable-next-line import/no-unresolved
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard.js';
// eslint-disable-next-line import/no-unresolved
import { ACCESS_COOKIE } from '../src/auth/jwt/jwt-cookie.helper.js';
// eslint-disable-next-line import/no-unresolved
import { JwtAuthService } from '../src/auth/jwt/jwt.service.js';
// eslint-disable-next-line import/no-unresolved
import type { UserState, UserStateService } from '../src/auth/user-state.service.js';

describe('JwtAuthGuard', () => {
  const reflector = new Reflector();
  const jwt = new JwtAuthService('a'.repeat(32), 60);
  let stateValue: UserState | null;
  const userState = { get: async () => stateValue } as unknown as UserStateService;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    stateValue = { role: 'admin', disabledAt: null, mustChangePassword: false };
    guard = new JwtAuthGuard(reflector, jwt, userState);
  });

  function mockCtx(cookies: Record<string, string> = {}): ExecutionContext {
    const req: Record<string, unknown> = { cookies };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('allows public endpoints without a cookie', async () => {
    const saveGet = reflector.getAllAndOverride;
    reflector.getAllAndOverride = (() => true) as typeof saveGet;
    expect(await guard.canActivate(mockCtx())).toBe(true);
    reflector.getAllAndOverride = saveGet;
  });

  it('rejects when no access cookie', async () => {
    await expect(guard.canActivate(mockCtx())).rejects.toThrow(UnauthorizedException);
  });

  it('attaches user and overrides role from DB state', async () => {
    const { token } = jwt.sign({ sub: 'u-1', role: 'user' });
    stateValue = { role: 'admin', disabledAt: null, mustChangePassword: false };
    const ctx = mockCtx({ [ACCESS_COOKIE]: token });
    expect(await guard.canActivate(ctx)).toBe(true);
    const req = ctx.switchToHttp().getRequest() as { user?: { sub: string; role: string } };
    expect(req.user?.sub).toBe('u-1');
    expect(req.user?.role).toBe('admin');
  });

  it('rejects invalid token', async () => {
    await expect(guard.canActivate(mockCtx({ [ACCESS_COOKIE]: 'garbage' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects disabled user', async () => {
    const { token } = jwt.sign({ sub: 'u-2', role: 'admin' });
    stateValue = { role: 'admin', disabledAt: new Date(), mustChangePassword: false };
    await expect(guard.canActivate(mockCtx({ [ACCESS_COOKIE]: token }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects missing user (state null)', async () => {
    const { token } = jwt.sign({ sub: 'u-3', role: 'admin' });
    stateValue = null;
    await expect(guard.canActivate(mockCtx({ [ACCESS_COOKIE]: token }))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
