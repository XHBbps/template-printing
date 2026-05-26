import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';

describe('Local login for non-emergency accounts', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const U = 'e2e_localadmin';
  const P = 'pw-e2e-localadmin-1';
  let id: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: U } });
    const u = await prisma.user.create({
      data: {
        localUsername: U,
        localPasswordHash: await bcrypt.hash(P, 10),
        role: 'admin',
        name: 'L Admin',
      },
    });
    id = u.id;
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: U } });
    await prisma.$disconnect();
    await app.close();
  });

  it('non-emergency local account can log in', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: U, password: P })
      .expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('disabled local account is rejected', async () => {
    await prisma.user.update({ where: { id }, data: { disabledAt: new Date() } });
    await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: U, password: P })
      .expect(401);
    await prisma.user.update({ where: { id }, data: { disabledAt: null } });
  });
});
