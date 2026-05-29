import { describe, it, expect, jest, afterEach } from '@jest/globals';

// eslint-disable-next-line import/no-unresolved
import { LarkBotWsService } from '../src/lark/lark-bot-ws.service.js';

// dispatch 桩;门控关闭/缺凭证时根本不应触达它,这里仅满足构造器。
const dispatch = {
  handleMessageReceive: jest.fn(),
  handleCardAction: jest.fn(),
} as never;

afterEach(() => {
  delete process.env.LARK_BOT_LONG_CONN_ENABLED;
});

describe('LarkBotWsService 门控', () => {
  it('开关未设 → onApplicationBootstrap 不抛、不建连接', () => {
    delete process.env.LARK_BOT_LONG_CONN_ENABLED;
    const svc = new LarkBotWsService(dispatch);
    expect(() => svc.onApplicationBootstrap()).not.toThrow();
  });

  it('开关 true 但缺 app 凭证 → 不抛(warn skip,不建连接)', () => {
    process.env.LARK_BOT_LONG_CONN_ENABLED = 'true';
    const savedId = process.env.LARK_SSO_APP_ID;
    const savedSecret = process.env.LARK_SSO_APP_SECRET;
    delete process.env.LARK_SSO_APP_ID;
    delete process.env.LARK_SSO_APP_SECRET;
    try {
      const svc = new LarkBotWsService(dispatch);
      expect(() => svc.onApplicationBootstrap()).not.toThrow();
    } finally {
      if (savedId !== undefined) process.env.LARK_SSO_APP_ID = savedId;
      if (savedSecret !== undefined) process.env.LARK_SSO_APP_SECRET = savedSecret;
    }
  });

  it('onApplicationShutdown 不抛', () => {
    const svc = new LarkBotWsService(dispatch);
    expect(() => svc.onApplicationShutdown()).not.toThrow();
  });
});
