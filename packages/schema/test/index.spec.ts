// eslint-disable-next-line import/no-unresolved
import { describe, it, expect } from 'vitest';

// eslint-disable-next-line import/no-unresolved -- TS path; resolver not configured yet
import { UserRoleSchema, ApiErrorSchema } from '../src/index.js';

describe('UserRoleSchema', () => {
  it('accepts admin', () => {
    expect(UserRoleSchema.parse('admin')).toBe('admin');
  });

  it('accepts emergency_admin', () => {
    expect(UserRoleSchema.parse('emergency_admin')).toBe('emergency_admin');
  });

  it('rejects unknown role', () => {
    expect(() => UserRoleSchema.parse('hacker')).toThrow();
  });
});

describe('ApiErrorSchema', () => {
  it('accepts minimal error', () => {
    const result = ApiErrorSchema.parse({
      ok: false,
      error: { code: 'BAD', message: 'Bad' },
    });
    expect(result.error.code).toBe('BAD');
  });

  it('accepts fieldErrors', () => {
    const result = ApiErrorSchema.parse({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'bad',
        fieldErrors: [{ path: 'name', code: 'REQUIRED', message: 'required' }],
      },
    });
    expect(result.error.fieldErrors).toHaveLength(1);
  });

  it('rejects ok=true', () => {
    expect(() => ApiErrorSchema.parse({ ok: true, error: { code: 'X', message: 'X' } })).toThrow();
  });
});
