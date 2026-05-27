import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';

describe('PATCH /admin/users/:id/role + safety', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const ADMIN = 'e2e_roleadmin';
  const ADMIN_PW = 'pw-e2e-roleadmin-1';
  let cookies: string[];
  let csrf: string;
  let meId: string;
  const NAMES = [ADMIN, 'e2e_a1', 'e2e_a2', 'e2e_em2'];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: { in: NAMES } } });
    const me = await prisma.user.create({
      data: {
        localUsername: ADMIN,
        localPasswordHash: await bcrypt.hash(ADMIN_PW, 10),
        role: 'emergency_admin',
        name: 'Role Admin',
      },
    });
    meId = me.id;
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
    await prisma.$disconnect();
    await app.close();
  });

  const patchRole = (id: string, role: string) =>
    request(app.getHttpServer())
      .patch(`/admin/users/${id}/role`)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .send({ role });

  it('cannot demote self (emergency_admin)', async () => {
    await patchRole(meId, 'user').expect(403);
  });

  it('cannot change an emergency_admin target', async () => {
    const em2 = await prisma.user.create({
      data: { localUsername: 'e2e_em2', role: 'emergency_admin', name: 'em2' },
    });
    await patchRole(em2.id, 'user').expect(403);
  });

  it('external local user cannot be promoted to admin', async () => {
    // Admin creates a local account → it has no larkOpenId → isExternal → cannot become admin
    const extRes = await request(app.getHttpServer())
      .post('/admin/users')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .send({ localUsername: 'e2e_ext_local', name: 'External Local' })
      .expect(201);
    const extId = extRes.body.user.id as string;
    NAMES.push('e2e_ext_local');

    const res = await patchRole(extId, 'admin').expect(403);
    expect(res.body.message).toContain('external_cannot_be_admin');
  });

  it('CONCURRENT demotion of the last two admins keeps >=1 (real concurrency)', async () => {
    // Make the ONLY two active role=admin users be a1,a2. Demote any other stray active admins first.
    await prisma.user.updateMany({
      where: { role: 'admin', disabledAt: null, localUsername: { notIn: ['e2e_a1', 'e2e_a2'] } },
      data: { role: 'user' },
    });
    const a1 = await prisma.user.create({
      data: { localUsername: 'e2e_a1', role: 'admin', name: 'a1' },
    });
    const a2 = await prisma.user.create({
      data: { localUsername: 'e2e_a2', role: 'admin', name: 'a2' },
    });

    const [r1, r2] = await Promise.allSettled([patchRole(a1.id, 'user'), patchRole(a2.id, 'user')]);
    const codes = [r1, r2]
      .map((r) => (r.status === 'fulfilled' ? (r.value as request.Response).status : 0))
      .sort();
    expect(codes).toEqual([200, 409]); // exactly one success, one conflict
    const remaining = await prisma.user.count({
      where: { role: 'admin', disabledAt: null, id: { in: [a1.id, a2.id] } },
    });
    expect(remaining).toBe(1); // never zero
  });
});
