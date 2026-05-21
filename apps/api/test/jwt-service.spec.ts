import { describe, it, expect, beforeAll } from '@jest/globals';

// eslint-disable-next-line import/no-unresolved
import { JwtAuthService } from '../src/auth/jwt/jwt.service.js';

describe('JwtAuthService', () => {
  let svc: JwtAuthService;

  beforeAll(() => {
    svc = new JwtAuthService('a'.repeat(32), 3600);
  });

  it('signs a token containing sub, role, csrf', () => {
    const { token, csrf } = svc.sign({ sub: 'user-1', role: 'admin' });
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
    expect(typeof csrf).toBe('string');
    expect(csrf.length).toBeGreaterThanOrEqual(32);
  });

  it('verifies a valid token and returns claims', () => {
    const { token, csrf } = svc.sign({ sub: 'user-2', role: 'user' });
    const claims = svc.verify(token);
    expect(claims.sub).toBe('user-2');
    expect(claims.role).toBe('user');
    expect(claims.csrf).toBe(csrf);
  });

  it('rejects a tampered token', () => {
    const { token } = svc.sign({ sub: 'user-3', role: 'user' });
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(() => svc.verify(tampered)).toThrow();
  });

  it('rejects an expired token', async () => {
    const shortLived = new JwtAuthService('a'.repeat(32), 1);
    const { token } = shortLived.sign({ sub: 'u', role: 'user' });
    await new Promise((r) => setTimeout(r, 1100));
    expect(() => shortLived.verify(token)).toThrow();
  });
});
