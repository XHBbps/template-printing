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

describe('Template sharing e2e', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const ADMIN = 'e2e_share_admin';
  const USERB = 'e2e_share_userb';
  const NONAME = 'e2e_share_noname';
  const PW = 'pw-e2e-share-1';
  let admin: Auth;
  let userb: Auth;
  let pubTplId: string;
  let unpubTplId: string;
  let nonameTplId: string;
  let privPubTplId: string;
  const VER_DATA = {
    id: 'v',
    meta: { name: 'x', description: '', version: 1, tags: [] },
    canvas: {
      cols: 1,
      rows: 1,
      cell: { w: 1, h: 1 },
      paper: 'A4',
      orientation: 'portrait',
      background: null,
    },
    schema: {},
    elements: [],
  };

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
    await prisma.user.deleteMany({ where: { localUsername: { in: [ADMIN, USERB, NONAME] } } });
    const adminU = await prisma.user.create({
      data: {
        localUsername: ADMIN,
        localPasswordHash: await bcrypt.hash(PW, 10),
        role: 'admin',
        mustChangePassword: false,
        name: 'Share Admin',
      },
    });
    await prisma.user.create({
      data: {
        localUsername: USERB,
        localPasswordHash: await bcrypt.hash(PW, 10),
        role: 'user',
        mustChangePassword: false,
        name: 'Share UserB',
      },
    });
    const noname = await prisma.user.create({
      data: {
        localUsername: NONAME,
        localPasswordHash: await bcrypt.hash(PW, 10),
        role: 'admin',
        mustChangePassword: false,
        name: null,
      },
    });

    const pub = await prisma.template.create({
      data: { name: '可分享模板', data: VER_DATA, ownerId: adminU.id, publishedVersion: 1 },
    });
    await prisma.templateVersion.create({
      data: { templateId: pub.id, version: 1, data: VER_DATA },
    });
    pubTplId = pub.id;
    const unpub = await prisma.template.create({
      data: { name: '未发布模板', data: VER_DATA, ownerId: adminU.id },
    });
    unpubTplId = unpub.id;
    const np = await prisma.template.create({
      data: {
        name: '无名作者模板',
        data: VER_DATA,
        ownerId: noname.id,
        publishedVersion: 1,
        visibility: 'public',
      },
    });
    await prisma.templateVersion.create({
      data: { templateId: np.id, version: 1, data: VER_DATA },
    });
    nonameTplId = np.id;
    // admin 的「已发布但私有」模板:用于验证他人读不到其版本(仅公共已发布版可跨 owner 读)
    const privPub = await prisma.template.create({
      data: { name: '私有已发布模板', data: VER_DATA, ownerId: adminU.id, publishedVersion: 1 },
    });
    await prisma.templateVersion.create({
      data: { templateId: privPub.id, version: 1, data: VER_DATA },
    });
    privPubTplId = privPub.id;

    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.use(cookieParser());
    await app.init();
    admin = await login(ADMIN);
    userb = await login(USERB);
  });
  afterAll(async () => {
    const ids = (
      await prisma.user.findMany({
        where: { localUsername: { in: [ADMIN, USERB, NONAME] } },
        select: { id: true },
      })
    ).map((u) => u.id);
    await prisma.template.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.user.deleteMany({ where: { localUsername: { in: [ADMIN, USERB, NONAME] } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('admin sets published template public', async () => {
    await request(app.getHttpServer())
      .patch(`/templates/${pubTplId}/visibility`)
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrf)
      .send({ visibility: 'public' })
      .expect(200);
  });

  it('public template appears in GET /templates/public with ownerName', async () => {
    const res = await request(app.getHttpServer())
      .get('/templates/public?limit=100')
      .set('Cookie', userb.cookie)
      .expect(200);
    const item = res.body.items.find((x: { id: string }) => x.id === pubTplId);
    expect(item).toBeTruthy();
    expect(item.ownerName).toBe('Share Admin');
  });

  it('ownerName falls back to — when owner has no name', async () => {
    const res = await request(app.getHttpServer())
      .get('/templates/public?limit=100')
      .set('Cookie', userb.cookie)
      .expect(200);
    const item = res.body.items.find((x: { id: string }) => x.id === nonameTplId);
    expect(item.ownerName).toBe('—');
  });

  it('setting unpublished template public → 400', async () => {
    await request(app.getHttpServer())
      .patch(`/templates/${unpubTplId}/visibility`)
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrf)
      .send({ visibility: 'public' })
      .expect(400);
  });

  it('non-admin cannot set visibility → 403', async () => {
    await request(app.getHttpServer())
      .patch(`/templates/${pubTplId}/visibility`)
      .set('Cookie', userb.cookie)
      .set('X-CSRF-Token', userb.csrf)
      .send({ visibility: 'private' })
      .expect(403);
  });

  it('userB copies admin public template (cross-owner) → owned private draft', async () => {
    const res = await request(app.getHttpServer())
      .post(`/templates/${pubTplId}/copy`)
      .set('Cookie', userb.cookie)
      .set('X-CSRF-Token', userb.csrf)
      .expect(201);
    const newId = res.body.id as string;
    const userbRow = await prisma.user.findUnique({ where: { localUsername: USERB } });
    const copy = await prisma.template.findUnique({ where: { id: newId } });
    expect(copy?.ownerId).toBe(userbRow!.id);
    expect(copy?.visibility).toBe('private');
    expect(copy?.publishedVersion).toBeNull();
    expect(copy?.hasUnpublishedChanges).toBe(true);
    expect(copy?.name).toBe('可分享模板 副本');
    expect(copy?.data).toEqual(VER_DATA);
  });

  it('copying a non-public template → 404', async () => {
    await request(app.getHttpServer())
      .post(`/templates/${unpubTplId}/copy`)
      .set('Cookie', userb.cookie)
      .set('X-CSRF-Token', userb.csrf)
      .expect(404);
  });

  it("userB's own list (GET /templates) does not include admin templates", async () => {
    const res = await request(app.getHttpServer())
      .get('/templates?limit=100')
      .set('Cookie', userb.cookie)
      .expect(200);
    const ids = res.body.items.map((x: { id: string }) => x.id);
    expect(ids).not.toContain(pubTplId);
  });

  it('public published version is readable cross-owner (公共库缩略图/预览)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/templates/${nonameTplId}/versions/1`)
      .set('Cookie', userb.cookie)
      .expect(200);
    expect(res.body.data).toEqual(VER_DATA);
  });

  it("private template's published version is NOT readable by others → 404", async () => {
    await request(app.getHttpServer())
      .get(`/templates/${privPubTplId}/versions/1`)
      .set('Cookie', userb.cookie)
      .expect(404);
  });

  it('POST /templates with visibility:public is silently ignored — template stays private', async () => {
    // Non-admin (userb) tries to create a template with visibility:'public' in the body.
    // The DTO strips unknown fields → visibility is not persisted → template is private.
    const res = await request(app.getHttpServer())
      .post('/templates')
      .set('Cookie', userb.cookie)
      .set('X-CSRF-Token', userb.csrf)
      .send({
        name: 'visibility-escape-test',
        visibility: 'public',
        data: VER_DATA,
      })
      .expect(201);
    const createdId = res.body.id as string;

    // Verify it does NOT appear in the public list
    const pubList = await request(app.getHttpServer())
      .get('/templates/public?limit=100')
      .set('Cookie', userb.cookie)
      .expect(200);
    const ids = pubList.body.items.map((x: { id: string }) => x.id);
    expect(ids).not.toContain(createdId);

    // Cleanup
    await prisma.template.delete({ where: { id: createdId } });
  });
});
