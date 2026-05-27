import { describe, it, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';

describe('POST /admin/users/:id/disable|enable', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const ADMIN = 'e2e_disadmin';
  const ADMIN_PW = 'pw-e2e-disadmin-1';
  const TARGET = 'e2e_distarget';
  const TARGET_PW = 'pw-e2e-distarget-1';
  let adminCookies: string[];
  let adminCsrf: string;
  let adminId: string;
  const NAMES = [ADMIN, TARGET, 'e2e_dis_a1'];

  const login = async (u: string, p: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: u, password: p });
    return {
      cookies: res.headers['set-cookie'] as unknown as string[],
      csrf: res.body.csrf as string,
    };
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: { in: NAMES } } });
    const a = await prisma.user.create({
      data: {
        localUsername: ADMIN,
        localPasswordHash: await bcrypt.hash(ADMIN_PW, 10),
        role: 'emergency_admin',
        name: 'Dis Admin',
      },
    });
    adminId = a.id;
    await prisma.user.create({
      data: {
        localUsername: TARGET,
        localPasswordHash: await bcrypt.hash(TARGET_PW, 10),
        role: 'user',
        name: 'Dis Target',
        // 内部账号才可签发 api-token；给一个假 larkOpenId 使其成为内部账号
        larkOpenId: 'ou_dis_target_fake',
      },
    });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.use(cookieParser());
    await app.init();
    const al = await login(ADMIN, ADMIN_PW);
    adminCookies = al.cookies;
    adminCsrf = al.csrf;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: { in: NAMES } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('disabled user is rejected on next request across cookie + refresh + Bearer', async () => {
    const t = await login(TARGET, TARGET_PW);
    const tid = (await prisma.user.findUnique({ where: { localUsername: TARGET } }))!.id;
    // target can access + create an API token while active
    await request(app.getHttpServer()).get('/users/me').set('Cookie', t.cookies).expect(200);
    const tokRes = await request(app.getHttpServer())
      .post('/users/me/api-tokens')
      .set('Cookie', t.cookies)
      .set('X-CSRF-Token', t.csrf)
      .send({ name: 'dis-tok' })
      .expect(200);
    const bearer = tokRes.body.plaintext as string;
    // admin disables target
    await request(app.getHttpServer())
      .post(`/admin/users/${tid}/disable`)
      .set('Cookie', adminCookies)
      .set('X-CSRF-Token', adminCsrf)
      .expect(201);
    // NEXT request: all three paths fail (evict → immediate, no TTL wait)
    await request(app.getHttpServer()).get('/users/me').set('Cookie', t.cookies).expect(401); // cookie access
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', t.cookies).expect(401); // refresh (tokens revoked)
    await request(app.getHttpServer())
      .get('/render/jobs?page=1&pageSize=1')
      .set('Authorization', `Bearer ${bearer}`)
      .expect(401); // bearer (revoked + owner disabled)
    // enable restores login ability
    await request(app.getHttpServer())
      .post(`/admin/users/${tid}/enable`)
      .set('Cookie', adminCookies)
      .set('X-CSRF-Token', adminCsrf)
      .expect(201);
    const t2 = await login(TARGET, TARGET_PW);
    await request(app.getHttpServer()).get('/users/me').set('Cookie', t2.cookies).expect(200);
  });

  it('cannot disable self / emergency_admin / last active admin', async () => {
    await request(app.getHttpServer())
      .post(`/admin/users/${adminId}/disable`)
      .set('Cookie', adminCookies)
      .set('X-CSRF-Token', adminCsrf)
      .expect(403); // self + emergency
    // last active admin: ensure exactly one active role=admin then try to disable it
    await prisma.user.updateMany({
      where: { role: 'admin', disabledAt: null, localUsername: { not: 'e2e_dis_a1' } },
      data: { role: 'user' },
    });
    const a1 = await prisma.user.create({
      data: { localUsername: 'e2e_dis_a1', role: 'admin', name: 'dis a1' },
    });
    await request(app.getHttpServer())
      .post(`/admin/users/${a1.id}/disable`)
      .set('Cookie', adminCookies)
      .set('X-CSRF-Token', adminCsrf)
      .expect(409);
  });
});
