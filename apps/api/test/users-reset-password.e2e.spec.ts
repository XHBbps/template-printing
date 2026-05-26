import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';

describe('POST /admin/users/:id/reset-password', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const ADMIN = 'e2e_rpadmin';
  const ADMIN_PW = 'pw-e2e-rpadmin-1';
  let cookies: string[];
  let csrf: string;
  const NAMES = [ADMIN, 'e2e_rp_local', 'e2e_rp_lark'];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: { in: NAMES } } });
    await prisma.user.deleteMany({ where: { larkOpenId: 'e2e_rp_open' } });
    await prisma.user.create({
      data: {
        localUsername: ADMIN,
        localPasswordHash: await bcrypt.hash(ADMIN_PW, 10),
        role: 'emergency_admin',
        name: 'RP Admin',
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
    await prisma.user.deleteMany({ where: { localUsername: { in: NAMES } } });
    await prisma.user.deleteMany({ where: { larkOpenId: 'e2e_rp_open' } });
    await prisma.$disconnect();
    await app.close();
  });

  const reset = (id: string) =>
    request(app.getHttpServer())
      .post(`/admin/users/${id}/reset-password`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf);

  it('resets a local account → new plaintext + mustChangePassword', async () => {
    const u = await prisma.user.create({
      data: {
        localUsername: 'e2e_rp_local',
        localPasswordHash: await bcrypt.hash('old-pw-123', 10),
        role: 'user',
        name: 'rp local',
        mustChangePassword: false,
      },
    });
    const res = await reset(u.id).expect(201);
    expect(typeof res.body.plaintext).toBe('string');
    expect(res.body.plaintext.length).toBeGreaterThanOrEqual(10);
    const row = await prisma.user.findUnique({ where: { id: u.id } });
    expect(row?.mustChangePassword).toBe(true);
  });

  it('400 for account without local password (lark-only)', async () => {
    const u = await prisma.user.create({
      data: { larkOpenId: 'e2e_rp_open', larkUserId: 'e2e_rp_lark', role: 'user', name: 'rp lark' },
    });
    await reset(u.id).expect(400);
  });
});
