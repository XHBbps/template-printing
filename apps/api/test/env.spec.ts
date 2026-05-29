import { describe, it, expect, afterEach, jest } from '@jest/globals';

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

  it('生产环境:配了 bitable token 但缺 RENDER_CALLBACK_SECRET → 启动期阻断', () => {
    setMinimalEnv();
    process.env.NODE_ENV = 'production';
    process.env.LARK_BITABLE_VERIFICATION_TOKEN = 'a'.repeat(16);
    delete process.env.RENDER_CALLBACK_SECRET;
    expect(() => validateEnv()).toThrow(/RENDER_CALLBACK_SECRET/);
  });

  it('非生产:配了 bitable token 但缺 RENDER_CALLBACK_SECRET → warn 不阻断', () => {
    setMinimalEnv(); // NODE_ENV 被删 → development
    process.env.LARK_BITABLE_VERIFICATION_TOKEN = 'a'.repeat(16);
    delete process.env.RENDER_CALLBACK_SECRET;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => validateEnv()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/RENDER_CALLBACK_SECRET/));
    warn.mockRestore();
  });

  it('配了 bot token 但缺 LARK_BOT_OPEN_ID → warn(不阻断)', () => {
    setMinimalEnv();
    process.env.LARK_BOT_VERIFICATION_TOKEN = 'b'.repeat(16);
    delete process.env.LARK_BOT_OPEN_ID;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => validateEnv()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/LARK_BOT_OPEN_ID/));
    warn.mockRestore();
  });
});
