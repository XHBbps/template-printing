import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';

describe('Remember-me cookie semantics e2e', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const USER = 'e2e_remember';
  const PW = 'pw-e2e-remember-1';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: USER } });
    await prisma.user.create({
      data: {
        localUsername: USER,
        localPasswordHash: await bcrypt.hash(PW, 10),
        role: 'emergency_admin',
        mustChangePassword: false,
        name: 'Remember Test',
      },
    });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: USER } });
    await prisma.$disconnect();
    await app.close();
  });

  function setCookieArr(res: request.Response): string[] {
    return res.headers['set-cookie'] as unknown as string[];
  }
  function find(arr: string[], prefix: string): string {
    const c = arr.find((x) => x.startsWith(prefix));
    if (!c) throw new Error(`cookie ${prefix} not found in ${JSON.stringify(arr)}`);
    return c;
  }

  it('remember=true → persistent cookies with Max-Age', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: USER, password: PW, remember: true })
      .expect(200);
    const arr = setCookieArr(res);
    expect(find(arr, 'tp_access=')).toMatch(/Max-Age=86400/i);
    expect(find(arr, 'tp_refresh=')).toMatch(/Max-Age=2592000/i);
    expect(find(arr, 'tp_remember=')).toMatch(/Max-Age=2592000/i);
    expect(find(arr, 'tp_remember=')).toMatch(/tp_remember=1/);
  });

  it('remember omitted → defaults to persistent (Max-Age present)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: USER, password: PW })
      .expect(200);
    expect(find(setCookieArr(res), 'tp_refresh=')).toMatch(/Max-Age=2592000/i);
  });

  it('remember=false → session cookies (no Max-Age / Expires)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: USER, password: PW, remember: false })
      .expect(200);
    const arr = setCookieArr(res);
    for (const prefix of ['tp_access=', 'tp_refresh=', 'tp_remember=']) {
      const c = find(arr, prefix);
      expect(c).not.toMatch(/Max-Age=/i);
      expect(c).not.toMatch(/Expires=/i);
    }
    expect(find(arr, 'tp_remember=')).toMatch(/tp_remember=0/);
  });
});
