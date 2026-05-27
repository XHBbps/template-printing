import { describe, it, expect } from '@jest/globals';

/* eslint-disable import/no-unresolved */
import { isInternal, isExternal } from '../src/auth/account-kind.js';
/* eslint-enable import/no-unresolved */

describe('account-kind', () => {
  it('飞书账号 = 内部', () => {
    expect(isInternal({ larkOpenId: 'ou_x', role: 'user' })).toBe(true);
  });
  it('超级管理员(无飞书)= 内部', () => {
    expect(isInternal({ larkOpenId: null, role: 'emergency_admin' })).toBe(true);
  });
  it('本地账号(非超管)= 外部', () => {
    expect(isInternal({ larkOpenId: null, role: 'user' })).toBe(false);
    expect(isExternal({ larkOpenId: null, role: 'admin' })).toBe(true);
  });
});
