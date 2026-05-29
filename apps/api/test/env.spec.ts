import { describe, it, expect, afterEach } from '@jest/globals';

// eslint-disable-next-line import/no-unresolved
import { validateEnv } from '../src/common/env.js';

describe('validateEnv', () => {
  const original = { ...process.env };

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in original)) delete process.env[k];
    }
    Object.assign(process.env, original);
  });

  function setMinimalEnv() {
    // Jest sets NODE_ENV=test by default; clear it so we exercise the schema's
    // 'development' default in the first test case.
    delete process.env.NODE_ENV;
    process.env.DATABASE_URL = 'postgres://localhost:5432/test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.FILE_SIG_SECRET = 'a'.repeat(32);
    process.env.LARK_SSO_APP_ID = 'cli_test';
    process.env.LARK_SSO_APP_SECRET = 'secret_test';
    process.env.LARK_SSO_REDIRECT_URI = 'http://localhost:3000/auth/lark/callback';
  }

  it('returns parsed env when all required vars set', () => {
    setMinimalEnv();
    const env = validateEnv();
    expect(env.DATABASE_URL).toBe('postgres://localhost:5432/test');
    expect(env.NODE_ENV).toBe('development');
  });

  it('throws when DATABASE_URL missing', () => {
    setMinimalEnv();
    delete process.env.DATABASE_URL;
    expect(() => validateEnv()).toThrow(/DATABASE_URL/);
  });

  it('throws when JWT_SECRET is too short', () => {
    setMinimalEnv();
    process.env.JWT_SECRET = 'short';
    expect(() => validateEnv()).toThrow(/JWT_SECRET/);
  });
});
