import { describe, it, expect } from '@jest/globals';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { CsrfGuard } from '../src/auth/guards/csrf.guard.js';

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();

  function mockCtx(
    method: string,
    headers: Record<string, string>,
    user?: { csrf: string },
  ): ExecutionContext {
    const req: Record<string, unknown> = { method, headers, user };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  it('allows GET without csrf header', () => {
    expect(guard.canActivate(mockCtx('GET', {}))).toBe(true);
  });

  it('allows HEAD/OPTIONS without csrf header', () => {
    expect(guard.canActivate(mockCtx('HEAD', {}))).toBe(true);
    expect(guard.canActivate(mockCtx('OPTIONS', {}))).toBe(true);
  });

  it('rejects POST without csrf header', () => {
    expect(() => guard.canActivate(mockCtx('POST', {}, { csrf: 'abc' }))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects POST with mismatched csrf', () => {
    expect(() =>
      guard.canActivate(mockCtx('POST', { 'x-csrf-token': 'wrong' }, { csrf: 'right' })),
    ).toThrow(ForbiddenException);
  });

  it('allows POST with matching csrf', () => {
    expect(
      guard.canActivate(mockCtx('POST', { 'x-csrf-token': 'token-123' }, { csrf: 'token-123' })),
    ).toBe(true);
  });

  it('rejects POST when no user attached (guard order error)', () => {
    expect(() => guard.canActivate(mockCtx('POST', { 'x-csrf-token': 'x' }))).toThrow(
      ForbiddenException,
    );
  });
});
