// eslint-disable-next-line import/no-unresolved
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
// eslint-disable-next-line import/no-unresolved
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { Test } from '@nestjs/testing';
// eslint-disable-next-line import/no-unresolved
import { PrismaClient } from '@prisma/client';
// eslint-disable-next-line import/no-unresolved
import bcrypt from 'bcryptjs';
// eslint-disable-next-line import/no-unresolved
import cookieParser from 'cookie-parser';
// eslint-disable-next-line import/no-unresolved
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';

describe('Uploads (e2e)', () => {
  let app: INestApplication;
  let accessCookie: string;
  let csrfToken: string;

  const prisma = new PrismaClient();
  const TEST_USERNAME = 'e2e_uploads';
  const TEST_PASSWORD = 'password-uploads-e2e';

  beforeAll(async () => {
    process.env.STORAGE_ROOT = '/tmp/test-storage';

    await prisma.user.deleteMany({ where: { localUsername: TEST_USERNAME } });
    await prisma.user.create({
      data: {
        localUsername: TEST_USERNAME,
        localPasswordHash: await bcrypt.hash(TEST_PASSWORD, 10),
        role: 'emergency_admin',
        mustChangePassword: false,
        name: 'Uploads E2E User',
      },
    });

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    await app.init();

    // Obtain a valid session (JWT cookie + CSRF token)
    const loginRes = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD });

    const setCookies = (loginRes.headers['set-cookie'] as unknown as string[]) ?? [];
    const accessCookieHeader = setCookies.find((c: string) => c.startsWith('tp_access='));
    if (!accessCookieHeader) throw new Error('Login failed: no tp_access cookie');
    // Extract just the cookie value (name=value; ...)
    accessCookie = accessCookieHeader.split(';')[0] ?? '';
    csrfToken = loginRes.body.csrf as string;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: TEST_USERNAME } });
    await prisma.$disconnect();
    await app.close();
  });

  it('accepts a clean SVG and returns a url', async () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>`,
    );
    const res = await request(app.getHttpServer())
      .post('/uploads/image')
      .set('Cookie', accessCookie)
      .set('x-csrf-token', csrfToken)
      .attach('file', svg, { filename: 'logo.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(201);
    expect(res.body.format).toBe('svg');
    expect(res.body.url).toMatch(/^\/uploads\/.+\.svg$/);
  });

  it('sanitises an SVG with a <script> (still returns 201)', async () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
    );
    const res = await request(app.getHttpServer())
      .post('/uploads/image')
      .set('Cookie', accessCookie)
      .set('x-csrf-token', csrfToken)
      .attach('file', svg, { filename: 'bad.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(201);
    expect(res.body.url).toBeDefined();
  });

  it('rejects when mime claim does not match magic bytes', async () => {
    const fakePng = Buffer.from('not actually a png');
    const res = await request(app.getHttpServer())
      .post('/uploads/image')
      .set('Cookie', accessCookie)
      .set('x-csrf-token', csrfToken)
      .attach('file', fakePng, { filename: 'fake.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });

  it('rejects oversized file (> 5 MB)', async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 0xff);
    const res = await request(app.getHttpServer())
      .post('/uploads/image')
      .set('Cookie', accessCookie)
      .set('x-csrf-token', csrfToken)
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' });
    expect([400, 413]).toContain(res.status);
  });
});
