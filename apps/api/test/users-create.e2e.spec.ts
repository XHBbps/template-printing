import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';

describe('POST /admin/users', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const ADMIN = 'e2e_createadmin';
  const ADMIN_PW = 'pw-e2e-createadmin-1';
  let cookies: string[];
  let csrf: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { localUsername: { in: [ADMIN, 'e2e_created_1', 'e2e_dup_1'] } },
    });
    await prisma.user.create({
      data: {
        localUsername: ADMIN,
        localPasswordHash: await bcrypt.hash(ADMIN_PW, 10),
        role: 'emergency_admin',
        name: 'Create Admin',
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
    csrf = res.body.csrf;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { localUsername: { in: [ADMIN, 'e2e_created_1', 'e2e_dup_1'] } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  it('creates local account and returns one-time plaintext', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/users')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .send({ localUsername: 'e2e_created_1', name: '新建测试', role: 'user' })
      .expect(201);
    expect(typeof res.body.plaintext).toBe('string');
    expect(res.body.plaintext.length).toBeGreaterThanOrEqual(10);
    expect(res.body.user.localUsername).toBe('e2e_created_1');
    const row = await prisma.user.findUnique({ where: { localUsername: 'e2e_created_1' } });
    expect(row?.mustChangePassword).toBe(true);
    expect(row?.localPasswordHash).toBeTruthy();
  });

  it('returns 409 on duplicate username', async () => {
    await prisma.user.create({ data: { localUsername: 'e2e_dup_1', role: 'user', name: 'dup' } });
    await request(app.getHttpServer())
      .post('/admin/users')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .send({ localUsername: 'e2e_dup_1', name: 'x', role: 'user' })
      .expect(409);
  });
});
