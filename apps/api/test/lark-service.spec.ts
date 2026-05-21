import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from 'undici';

// eslint-disable-next-line import/no-unresolved
import { LarkService } from '../src/auth/lark/lark.service.js';

describe('LarkService', () => {
  const PASSPORT_BASE = 'https://passport.feishu.cn';
  const OPEN_BASE = 'https://open.feishu.cn';
  let svc: LarkService;
  let mockAgent: MockAgent;
  let originalDispatcher: Dispatcher;

  beforeAll(() => {
    originalDispatcher = getGlobalDispatcher();
  });

  afterAll(() => {
    setGlobalDispatcher(originalDispatcher);
  });

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
    svc = new LarkService({
      appId: 'cli_test',
      appSecret: 'secret_test',
      passportBase: PASSPORT_BASE,
      openBase: OPEN_BASE,
    });
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it('buildAuthorizeUrl produces correct URL with state', () => {
    const url = svc.buildAuthorizeUrl({
      redirectUri: 'https://example.com/cb',
      state: 'abc',
    });
    expect(url).toContain('https://accounts.feishu.cn/open-apis/authen/v1/index');
    expect(url).toContain('app_id=cli_test');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcb');
    expect(url).toContain('state=abc');
  });

  it('exchangeCode trades code for user_access_token', async () => {
    mockAgent
      .get(PASSPORT_BASE)
      .intercept({
        path: '/suite/passport/oauth/token',
        method: 'POST',
        body: (raw) => {
          const body = JSON.parse(raw as string);
          return body.grant_type === 'authorization_code' && body.code === 'code-123';
        },
      })
      .reply(
        200,
        {
          access_token: 'u-at-xyz',
          token_type: 'Bearer',
          expires_in: 7200,
          refresh_token: 'u-rt-xyz',
          scope: 'contact:user.base:readonly',
        },
        { headers: { 'content-type': 'application/json' } },
      );

    const result = await svc.exchangeCode({
      code: 'code-123',
      redirectUri: 'https://example.com/cb',
    });
    expect(result.access_token).toBe('u-at-xyz');
    expect(result.expires_in).toBe(7200);
  });

  it('fetchUserInfo returns parsed user fields', async () => {
    mockAgent
      .get(OPEN_BASE)
      .intercept({ path: '/open-apis/authen/v1/user_info', method: 'GET' })
      .reply(
        200,
        {
          code: 0,
          msg: 'success',
          data: {
            open_id: 'ou_abc',
            union_id: 'on_abc',
            user_id: 'uid_abc',
            name: 'Test User',
            en_name: 'Test User',
            email: 'test@example.com',
            avatar_url: 'https://avatar.example.com/abc.jpg',
          },
        },
        { headers: { 'content-type': 'application/json' } },
      );

    const info = await svc.fetchUserInfo('u-at-xyz');
    expect(info.open_id).toBe('ou_abc');
    expect(info.union_id).toBe('on_abc');
    expect(info.name).toBe('Test User');
    expect(info.avatar_url).toBe('https://avatar.example.com/abc.jpg');
  });

  it('fetchUserInfo throws on non-zero code', async () => {
    mockAgent
      .get(OPEN_BASE)
      .intercept({ path: '/open-apis/authen/v1/user_info', method: 'GET' })
      .reply(
        200,
        { code: 99991663, msg: 'invalid access token', data: null },
        { headers: { 'content-type': 'application/json' } },
      );

    await expect(svc.fetchUserInfo('bad-token')).rejects.toThrow(/invalid access token/);
  });
});
