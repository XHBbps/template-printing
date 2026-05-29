import { describe, it, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';

/** P2:listJobs 分页参数无校验,?page=abc→Number('abc')=NaN→Prisma 500。改 zod 校验返 400。 */
describe('GET /render/jobs 分页校验 (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const USERNAME = 'e2e_listjobs_val';
  const PASSWORD = 'pw-listjobs-1';
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: USERNAME } });
    await prisma.user.create({
      data: {
        localUsername: USERNAME,
        localPasswordHash: await bcrypt.hash(PASSWORD, 10),
        role: 'user',
        mustChangePassword: false,
        name: 'ListJobs Val',
      },
    });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: USERNAME, password: PASSWORD })
      .expect(200);
    cookie = (login.headers['set-cookie'] as unknown as string[]).join('; ');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: USERNAME } });
    await prisma.$disconnect();
    await app.close();
  });

  it('非法 page=abc → 400(而非 500)', async () => {
    await request(app.getHttpServer())
      .get('/render/jobs?page=abc')
      .set('Cookie', cookie)
      .expect(400);
  });

  it('非法 pageSize=0 → 400(min(1) clamp)', async () => {
    await request(app.getHttpServer())
      .get('/render/jobs?pageSize=0')
      .set('Cookie', cookie)
      .expect(400);
  });

  it('缺省/合法参数 → 200', async () => {
    await request(app.getHttpServer()).get('/render/jobs').set('Cookie', cookie).expect(200);
    await request(app.getHttpServer())
      .get('/render/jobs?page=1&pageSize=20')
      .set('Cookie', cookie)
      .expect(200);
  });
});
