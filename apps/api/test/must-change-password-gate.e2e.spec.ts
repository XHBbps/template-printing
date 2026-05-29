import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';
// eslint-disable-next-line import/no-unresolved
import { ApiTokenService } from '../src/auth/api-token/api-token.service.js';

/**
 * P1 强制改密后端落地:mustChangePassword=true 时,后端除白名单(读 me / 改密)外一律 403,
 * 堵住"前端仅软拦截、后端仍签发完整有效 token"导致的绕过(含创建长期 API token / 调 render)。
 */
describe('强制改密后端闸 e2e', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const USERNAME = 'e2e_mustchange';
  const PASSWORD = 'init-pass-123';
  let userId: string;
  let tokenPlain: string;

  beforeAll(async () => {
    await prisma.apiToken.deleteMany({ where: { user: { localUsername: USERNAME } } });
    await prisma.user.deleteMany({ where: { localUsername: USERNAME } });
    const user = await prisma.user.create({
      data: {
        localUsername: USERNAME,
        localPasswordHash: await bcrypt.hash(PASSWORD, 10),
        // emergency_admin 是 internal 账号(可持 API token),且 bootstrap 时 mustChangePassword=true,
        // 用它一条流程同时覆盖 cookie 路径(JwtAuthGuard)与 Bearer 路径(ApiAuthGuard)的闸门。
        role: 'emergency_admin',
        mustChangePassword: true, // 初始/重置状态
        name: 'Must Change',
      },
    });
    userId = user.id;
    // 直接种一个该用户的 API token(模拟改密前已持有的长期 token),验证 Bearer 路径也被闸住。
    tokenPlain = ApiTokenService.generatePlaintext();
    await prisma.apiToken.create({
      data: {
        userId,
        name: 'seed',
        tokenHash: ApiTokenService.hash(tokenPlain),
        prefix: ApiTokenService.getPrefix(tokenPlain),
      },
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await prisma.apiToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { localUsername: USERNAME } });
    await prisma.$disconnect();
    await app.close();
  });

  it('完整流程:登录→业务API 403→读me/改密放行→改密后恢复', async () => {
    const agent = request.agent(app.getHttpServer());

    // 1) 登录成功,返回 mustChangePassword=true + 完整 cookie
    const login = await agent
      .post('/auth/local/login')
      .send({ username: USERNAME, password: PASSWORD })
      .expect(200);
    expect(login.body.mustChangePassword).toBe(true);
    const csrf = login.body.csrf as string;

    // 2) 业务 API(GET /templates)被闸住 → 403 MUST_CHANGE_PASSWORD
    const blocked = await agent.get('/templates').expect(403);
    expect(blocked.body.code).toBe('MUST_CHANGE_PASSWORD');

    // 3) 关键绕过点:创建长期 API token 也被闸住 → 403
    await agent
      .post('/users/me/api-tokens')
      .set('x-csrf-token', csrf)
      .send({ name: 'evil' })
      .expect(403);

    // 4) Bearer 路径(改密前已持有的 token)调 render 同样被闸住 → 403
    const bearerBlocked = await request(app.getHttpServer())
      .post('/render')
      .set('authorization', `Bearer ${tokenPlain}`)
      .send({ templateId: 'whatever' })
      .expect(403);
    expect(bearerBlocked.body.code).toBe('MUST_CHANGE_PASSWORD');

    // 5) 白名单:读 me 放行(前端据此判断弹窗)
    const me = await agent.get('/users/me').expect(200);
    expect(me.body.user.mustChangePassword).toBe(true);

    // 6) 白名单:改密放行
    await agent
      .patch('/users/me/password')
      .set('x-csrf-token', csrf)
      .send({ currentPassword: PASSWORD, newPassword: 'brand-new-pass-456' })
      .expect(200);

    // 7) 改密后(已 evict)业务 API 恢复 → 200
    await agent.get('/templates').expect(200);
  });
});
