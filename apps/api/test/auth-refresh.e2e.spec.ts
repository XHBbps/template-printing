import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';

describe('Refresh + logout e2e', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const TEST_USERNAME = 'e2e_refresh';
  const TEST_PASSWORD = 'password-refresh-1';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: TEST_USERNAME } });
    await prisma.user.create({
      data: {
        localUsername: TEST_USERNAME,
        localPasswordHash: await bcrypt.hash(TEST_PASSWORD, 10),
        role: 'emergency_admin',
        name: 'Test Refresh',
      },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: TEST_USERNAME } });
    await prisma.$disconnect();
    await app.close();
  });

  async function loginAndGetCookies(): Promise<{ cookies: string; csrf: string }> {
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
      .expect(200);
    return {
      cookies: (res.headers['set-cookie'] as unknown as string[]).join('; '),
      csrf: res.body.csrf,
    };
  }

  it('GET /users/me returns user with valid cookie', async () => {
    const { cookies } = await loginAndGetCookies();
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', cookies)
      .expect(200);
    expect(res.body.user.role).toBe('emergency_admin');
  });

  it('GET /users/me returns 401 without cookie', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
  });

  it('POST /auth/refresh rotates tokens', async () => {
    const { cookies } = await loginAndGetCookies();
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);
    expect(res.body.ok).toBe(true);
    const newCookies = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(newCookies).toMatch(/tp_access=/);
    expect(newCookies).toMatch(/tp_refresh=/);
  });

  it('POST /auth/logout revokes refresh + clears cookies', async () => {
    const { cookies, csrf } = await loginAndGetCookies();
    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .expect(204);
    const cleared = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cleared).toMatch(/tp_access=;/);
    expect(cleared).toMatch(/tp_refresh=;/);
  });

  it('POST /auth/refresh fails after the refresh cookie is revoked', async () => {
    const { cookies, csrf } = await loginAndGetCookies();
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .expect(204);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookies).expect(401);
  });

  it('POST /auth/logout without CSRF token still succeeds (idempotent, @Public since iter 23)', async () => {
    const { cookies } = await loginAndGetCookies();
    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookies).expect(204);
  });
});
