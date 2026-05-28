import { describe, it, expect } from 'vitest';

// eslint-disable-next-line import/no-unresolved
import { jitterBackoff } from '../src/backoff.js';

describe('jitterBackoff', () => {
  it('指数基线 ±50% jitter,落在 [0.5,1.5]×base×2^(n-1)', () => {
    for (const n of [1, 2, 3]) {
      const base = 2000 * Math.pow(2, n - 1); // 2000 / 4000 / 8000
      for (let i = 0; i < 200; i++) {
        const d = jitterBackoff(n);
        expect(d).toBeGreaterThanOrEqual(Math.floor(base * 0.5));
        expect(d).toBeLessThanOrEqual(Math.ceil(base * 1.5));
      }
    }
  });
  it('返回整数', () => {
    expect(Number.isInteger(jitterBackoff(1))).toBe(true);
  });
});
