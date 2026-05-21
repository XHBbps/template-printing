import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';

describe('Local emergency login e2e', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const TEST_USERNAME = 'e2e_emergency';
  const TEST_PASSWORD = 'password-e2e-1';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: TEST_USERNAME } });
    await prisma.user.create({
      data: {
        localUsername: TEST_USERNAME,
        localPasswordHash: await bcrypt.hash(TEST_PASSWORD, 10),
        role: 'emergency_admin',
        mustChangePassword: false,
        name: 'Test Emergency',
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

  it('POST /auth/local/login succeeds for valid creds', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.csrf).toMatch(/^[0-9a-f]+$/);
    const setCookies = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(setCookies).toMatch(/tp_access=/);
    expect(setCookies).toMatch(/tp_refresh=/);
  });

  it('rejects wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: TEST_USERNAME, password: 'wrong' })
      .expect(401);
  });

  it('rejects unknown user', async () => {
    await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: 'nonexistent', password: 'x' })
      .expect(401);
  });
});
