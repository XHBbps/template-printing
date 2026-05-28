/**
 * e2e: GET /render/:jobId 归属校验 (V1 IDOR fix)
 *
 * 对齐 template-sharing.e2e.spec.ts 的 bootstrap：
 *   Test.createTestingModule({ imports: [AppModule] }) + supertest + 直接 prisma seeding。
 *
 * 种子：owner A + owner B 两个普通用户 + admin；A 拥有一个模板 + 一个 render_job。
 * 断言：
 *   - B 读 A 的 jobId → 404（不泄露存在性）
 *   - A 读自己的 jobId → 200
 *   - admin 读 A 的 jobId → 200
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';

interface Auth {
  cookie: string;
  csrf: string;
}

describe('GET /render/:jobId ownership (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const OWNER_A = 'e2e_render_owner_a';
  const OWNER_B = 'e2e_render_owner_b';
  const ADMIN = 'e2e_render_admin';
  const USERS = [OWNER_A, OWNER_B, ADMIN];
  const PW = 'pw-e2e-render-1';
  let authA: Auth;
  let authB: Auth;
  let authAdmin: Auth;
  let templateAId: string;
  let jobAId: string;

  async function login(u: string): Promise<Auth> {
    const res = await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ username: u, password: PW })
      .expect(200);
    return {
      cookie: (res.headers['set-cookie'] as unknown as string[]).join('; '),
      csrf: res.body.csrf as string,
    };
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: { in: USERS } } });
    const hash = await bcrypt.hash(PW, 10);
    const ownerA = await prisma.user.create({
      data: {
        localUsername: OWNER_A,
        localPasswordHash: hash,
        role: 'user',
        mustChangePassword: false,
        name: 'Render Owner A',
      },
    });
    await prisma.user.create({
      data: {
        localUsername: OWNER_B,
        localPasswordHash: hash,
        role: 'user',
        mustChangePassword: false,
        name: 'Render Owner B',
      },
    });
    await prisma.user.create({
      data: {
        localUsername: ADMIN,
        localPasswordHash: hash,
        role: 'admin',
        mustChangePassword: false,
        name: 'Render Admin',
      },
    });

    const tplA = await prisma.template.create({
      data: { name: 'e2e render ownership tpl A', data: {}, ownerId: ownerA.id },
    });
    templateAId = tplA.id;

    const jobA = await prisma.renderJob.create({
      data: {
        templateId: templateAId,
        data: {},
        formats: ['pdf'],
        status: 'success',
        templateVersion: 1,
      },
    });
    jobAId = jobA.id;

    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.use(cookieParser());
    await app.init();
    authA = await login(OWNER_A);
    authB = await login(OWNER_B);
    authAdmin = await login(ADMIN);
  });

  afterAll(async () => {
    const ids = (
      await prisma.user.findMany({
        where: { localUsername: { in: USERS } },
        select: { id: true },
      })
    ).map((u) => u.id);
    await prisma.renderJob.deleteMany({ where: { templateId: templateAId } });
    await prisma.template.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.user.deleteMany({ where: { localUsername: { in: USERS } } });
    await prisma.$disconnect();
    await app.close();
  });

  it("B cannot read A's render job → 404 (no existence leak)", async () => {
    await request(app.getHttpServer())
      .get(`/render/${jobAId}`)
      .set('Cookie', authB.cookie)
      .expect(404);
  });

  it('A can read own render job → 200', async () => {
    const res = await request(app.getHttpServer())
      .get(`/render/${jobAId}`)
      .set('Cookie', authA.cookie)
      .expect(200);
    expect(res.body.jobId).toBe(jobAId);
    expect(res.body.status).toBe('success');
  });

  it("admin can read A's render job → 200", async () => {
    const res = await request(app.getHttpServer())
      .get(`/render/${jobAId}`)
      .set('Cookie', authAdmin.cookie)
      .expect(200);
    expect(res.body.jobId).toBe(jobAId);
  });
});
