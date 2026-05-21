import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';

describe('Lark OAuth e2e', () => {
  let app: INestApplication;
  let mockAgent: MockAgent;
  let originalDispatcher: Dispatcher;

  beforeAll(async () => {
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await mockAgent.close();
    setGlobalDispatcher(originalDispatcher);
    await app.close();
  });

  beforeEach(() => {
    // Re-create the mock pool between tests
    mockAgent.removeAllListeners();
  });

  it('GET /auth/lark/login sets state cookie and redirects to Feishu authorize', async () => {
    const res = await request(app.getHttpServer()).get('/auth/lark/login').expect(302);
    expect(res.headers.location).toMatch(
      /^https:\/\/accounts\.feishu\.cn\/open-apis\/authen\/v1\/index/,
    );
    expect((res.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(/tp_lark_state=/);
  });

  it('GET /auth/lark/callback completes upsert + signs JWT cookies', async () => {
    const passportPool = mockAgent.get('https://passport.feishu.cn');
    const openPool = mockAgent.get('https://open.feishu.cn');

    passportPool.intercept({ path: '/suite/passport/oauth/token', method: 'POST' }).reply(200, {
      access_token: 'user-at',
      token_type: 'Bearer',
      expires_in: 7200,
      refresh_token: 'user-rt',
      scope: 'contact:user.base:readonly',
    });
    openPool.intercept({ path: '/open-apis/authen/v1/user_info', method: 'GET' }).reply(200, {
      code: 0,
      msg: 'ok',
      data: {
        open_id: 'ou_e2e_' + Date.now(),
        union_id: 'on_e2e',
        user_id: 'uid_e2e',
        name: 'E2E User',
        email: 'e2e@example.com',
        avatar_url: 'https://example.com/avatar.png',
      },
    });

    const loginRes = await request(app.getHttpServer()).get('/auth/lark/login').expect(302);
    const cookies = (loginRes.headers['set-cookie'] as unknown as string[]).join('; ');
    const stateMatch = cookies.match(/tp_lark_state=([0-9a-f]+)/);
    if (!stateMatch) throw new Error('No state cookie');
    const state = stateMatch[1];

    const callbackRes = await request(app.getHttpServer())
      .get(`/auth/lark/callback?code=fake-code&state=${state}`)
      .set('Cookie', cookies)
      .expect(302);

    expect(callbackRes.headers.location).toMatch(/^\/\?csrf=[0-9a-f]+$/);
    const setCookies = (callbackRes.headers['set-cookie'] as unknown as string[]).join(';');
    expect(setCookies).toMatch(/tp_access=/);
    expect(setCookies).toMatch(/tp_refresh=/);
  });

  it('callback rejects mismatched state', async () => {
    const loginRes = await request(app.getHttpServer()).get('/auth/lark/login').expect(302);
    const cookies = (loginRes.headers['set-cookie'] as unknown as string[]).join('; ');
    await request(app.getHttpServer())
      .get('/auth/lark/callback?code=fake&state=wrong-state')
      .set('Cookie', cookies)
      .expect(400);
  });
});
