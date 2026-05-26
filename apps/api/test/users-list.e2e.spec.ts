import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';

describe('GET /admin/users', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const ADMIN = 'e2e_listadmin';
  const ADMIN_PW = 'pw-e2e-listadmin-1';
  let cookies: string[];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: ADMIN } });
    await prisma.user.create({
      data: {
        localUsername: ADMIN,
        localPasswordHash: await bcrypt.hash(ADMIN_PW, 10),
        role: 'emergency_admin',
        name: 'List Admin',
      },
    });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.use(cookieParser());
    await app.init();
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: ADMIN, password: ADMIN_PW });
    cookies = res.headers['set-cookie'] as unknown as string[];
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: ADMIN } });
    await prisma.$disconnect();
    await app.close();
  });

  it('returns paginated shape with can fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/users?page=1&pageSize=50')
      .set('Cookie', cookies)
      .expect(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('total');
    expect(res.body.page).toBe(1);
    const me = res.body.items.find((u: any) => u.localUsername === ADMIN);
    expect(me).toBeTruthy();
    expect(me.accountType).toBe('local');
    expect(me.can.disable).toBe(false); // emergency_admin 不可禁用
    expect(me.can.changeRole).toBe(false);
    expect(me.disabledReason).toBe('emergency_admin_protected');
  });

  it('rejects unauthenticated with 401', async () => {
    await request(app.getHttpServer()).get('/admin/users').expect(401);
  });
});
