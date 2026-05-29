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
import { RefreshTokenService } from '../src/auth/jwt/refresh-token.service.js';

/**
 * review 第 7 节「需进一步验证项」#1:refresh 并发分叉。
 * 同一 refresh token 并发两次 POST /auth/refresh,断言最终只有一套会话有效
 * (即该用户名下未吊销、未过期的 refresh token 只剩 1 个)。
 *
 * 修复前:verify(读 revokedAt=null)+ revoke + create 非原子,两请求都先 verify 通过 →
 * 各自 create 一个新 token → 分叉出两套有效会话。
 * 修复后:revoke 改 updateMany CAS({id,revokedAt:null}),仅 count===1 的赢家继续轮换,
 * 输家拿不到占位 → 401,不再 create 第二套。
 */
describe('refresh 并发分叉 (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const USERNAME = 'e2e_refresh_race';
  const PASSWORD = 'pw-refresh-race-1';
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: USERNAME } });
    const u = await prisma.user.create({
      data: {
        localUsername: USERNAME,
        localPasswordHash: await bcrypt.hash(PASSWORD, 10),
        role: 'user',
        mustChangePassword: false,
        name: 'Refresh Race',
      },
    });
    userId = u.id;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: USERNAME } });
    await prisma.$disconnect();
    await app.close();
  });

  it('同一 refresh token 并发两次 refresh → 最终只剩一套有效会话', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: USERNAME, password: PASSWORD })
      .expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[]).join('; ');

    // 并发两次,带同一 refresh cookie
    const [r1, r2] = await Promise.all([
      request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie),
      request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie),
    ]);

    // 至少一个成功(200);CAS 后另一个应 401(输家),分叉时则两个都 200。
    const okCount = [r1, r2].filter((r) => r.status === 200).length;
    expect(okCount).toBeGreaterThanOrEqual(1);

    // 核心断言:用户名下未吊销、未过期的 refresh token 只能有 1 个(无分叉)。
    const validCount = await prisma.refreshToken.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    expect(validCount).toBe(1);
  });

  it('service 层:revokeIfActive 对同一 token 只能赢一次(CAS,确定性证明防分叉)', async () => {
    // 直接在 service 层强制"两请求都先 verify 通过、再各自吊销"的最坏交错。
    const svc = new RefreshTokenService(prisma, 3600);
    const { plaintext, id } = await svc.create(userId);

    // 两个并发请求各自 verify —— 都读到 revokedAt=null → 都认为 token 有效(这是分叉的前提)。
    const [v1, v2] = await Promise.all([svc.verify(plaintext), svc.verify(plaintext)]);
    expect(v1).not.toBeNull();
    expect(v2).not.toBeNull();

    // 但原子 CAS 吊销同一行:第一个赢(true),第二个输(false)→ 输家不得 create 第二套会话。
    const won1 = await svc.revokeIfActive(id);
    const won2 = await svc.revokeIfActive(id);
    expect(won1).toBe(true);
    expect(won2).toBe(false);

    await prisma.refreshToken.deleteMany({ where: { id } });
  });
});
