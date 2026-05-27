import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';

describe('POST /users/me/api-tokens — internal-only gate', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  // emergency_admin (internal — role===emergency_admin)
  const ADMIN = 'e2e_apitok_admin';
  const ADMIN_PW = 'pw-e2e-apitok-admin-1';

  // external local account (no larkOpenId, role=user)
  const EXT = 'e2e_apitok_ext';
  const EXT_PW = 'pw-e2e-apitok-ext-1';

  let adminCookies: string[];
  let adminCsrf: string;

  let extCookies: string[];
  let extCsrf: string;

  const login = async (u: string, p: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: u, password: p })
      .expect(200);
    return {
      cookies: res.headers['set-cookie'] as unknown as string[],
      csrf: res.body.csrf as string,
    };
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: { in: [ADMIN, EXT] } } });

    // Create internal emergency_admin user
    await prisma.user.create({
      data: {
        localUsername: ADMIN,
        localPasswordHash: await bcrypt.hash(ADMIN_PW, 10),
        role: 'emergency_admin',
        name: 'ApiTok Admin',
      },
    });

    // Create external local user (admin-created, no larkOpenId)
    await prisma.user.create({
      data: {
        localUsername: EXT,
        localPasswordHash: await bcrypt.hash(EXT_PW, 10),
        role: 'user',
        name: 'ApiTok External',
        mustChangePassword: false,
      },
    });

    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.use(cookieParser());
    await app.init();

    const al = await login(ADMIN, ADMIN_PW);
    adminCookies = al.cookies;
    adminCsrf = al.csrf;

    const el = await login(EXT, EXT_PW);
    extCookies = el.cookies;
    extCsrf = el.csrf;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: { in: [ADMIN, EXT] } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('EXTERNAL account → POST /users/me/api-tokens returns 403 with external_account_forbidden', async () => {
    const res = await request(app.getHttpServer())
      .post('/users/me/api-tokens')
      .set('Cookie', extCookies)
      .set('X-CSRF-Token', extCsrf)
      .send({ name: 'ext-token' })
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('external_account_forbidden');
  });

  it('INTERNAL account (emergency_admin) → POST /users/me/api-tokens succeeds with plaintext', async () => {
    const res = await request(app.getHttpServer())
      .post('/users/me/api-tokens')
      .set('Cookie', adminCookies)
      .set('X-CSRF-Token', adminCsrf)
      .send({ name: 'internal-token' })
      .expect(200);
    expect(typeof res.body.plaintext).toBe('string');
    expect(res.body.plaintext.length).toBeGreaterThan(0);
    expect(res.body.plaintext).toMatch(/^tpkn_/);
  });
});
