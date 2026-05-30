import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBotDispatchService } from '../src/lark/lark-bot-dispatch.service.js';

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

describe('Lark bot template visibility e2e', () => {
  let app: INestApplication;
  let dispatch: LarkBotDispatchService;
  const prisma = new PrismaClient();
  const OWNER = 'e2e_larkvis_owner';
  const OTHER = 'e2e_larkvis_other';
  const PW = 'pw-e2e-larkvis-1';
  let ownerId: string;
  let otherId: string;
  let publicPublishedId: string;
  let privatePublishedId: string;
  let publicUnpublishedId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: { in: [OWNER, OTHER] } } });
    const owner = await prisma.user.create({
      data: {
        localUsername: OWNER,
        localPasswordHash: await bcrypt.hash(PW, 10),
        role: 'user',
        mustChangePassword: false,
        name: 'Lark Vis Owner',
      },
    });
    ownerId = owner.id;
    const other = await prisma.user.create({
      data: {
        localUsername: OTHER,
        localPasswordHash: await bcrypt.hash(PW, 10),
        role: 'user',
        mustChangePassword: false,
        name: 'Lark Vis Other',
      },
    });
    otherId = other.id;

    // (1) public + published → 所有人可见
    const t1 = await prisma.template.create({
      data: {
        name: 'public-published',
        data: VER_DATA,
        ownerId: owner.id,
        visibility: 'public',
        publishedVersion: 2,
      },
    });
    publicPublishedId = t1.id;

    // (2) private + published → 仅 owner 可见(本人),他人/匿名不可见
    const t2 = await prisma.template.create({
      data: {
        name: 'private-published',
        data: VER_DATA,
        ownerId: owner.id,
        visibility: 'private',
        publishedVersion: 2,
      },
    });
    privatePublishedId = t2.id;

    // (3) public + unpublished → 任何人都不可见(未发布)
    const t3 = await prisma.template.create({
      data: {
        name: 'public-unpublished',
        data: VER_DATA,
        ownerId: owner.id,
        visibility: 'public',
        publishedVersion: null,
      },
    });
    publicUnpublishedId = t3.id;

    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    await app.init();
    dispatch = app.get(LarkBotDispatchService);
  });

  afterAll(async () => {
    const ids = (
      await prisma.user.findMany({
        where: { localUsername: { in: [OWNER, OTHER] } },
        select: { id: true },
      })
    ).map((u) => u.id);
    await prisma.template.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.user.deleteMany({ where: { localUsername: { in: [OWNER, OTHER] } } });
    await prisma.$disconnect();
    await app.close();
  });

  // pageSize 取大,避免共享测试库里其它 public 模板把目标挤到下一页造成偶发。
  const BIG = 1000;

  it('未绑定账号(userId=null)只见公开+已发布', async () => {
    const { templates } = await dispatch.listBotTemplates({ userId: null, pageSize: BIG });
    const ids = templates.map((t) => t.id);
    expect(ids).toContain(publicPublishedId);
    expect(ids).not.toContain(privatePublishedId);
    expect(ids).not.toContain(publicUnpublishedId);
  });

  it('本人(owner)可见自己的「私有但已发布」模板', async () => {
    const { templates } = await dispatch.listBotTemplates({ userId: ownerId, pageSize: BIG });
    const ids = templates.map((t) => t.id);
    expect(ids).toContain(publicPublishedId);
    expect(ids).toContain(privatePublishedId); // 本人私有已发布 → 可见
    expect(ids).not.toContain(publicUnpublishedId); // 未发布 → 仍不可见
  });

  it('他人(other)不可见 owner 的私有模板(防越权)', async () => {
    const { templates } = await dispatch.listBotTemplates({ userId: otherId, pageSize: BIG });
    const ids = templates.map((t) => t.id);
    expect(ids).toContain(publicPublishedId);
    expect(ids).not.toContain(privatePublishedId); // 非本人 → 不可见
    expect(ids).not.toContain(publicUnpublishedId);
  });

  it('分页:page/pageSize 生效,翻页返回不同条目', async () => {
    const p0 = await dispatch.listBotTemplates({ userId: ownerId, page: 0, pageSize: 1 });
    expect(p0.pageSize).toBe(1);
    expect(p0.templates).toHaveLength(1);
    expect(p0.total).toBeGreaterThanOrEqual(2); // owner 至少能见 公开+私有 两个已发布
    const p1 = await dispatch.listBotTemplates({ userId: ownerId, page: 1, pageSize: 1 });
    expect(p1.templates[0]?.id).not.toBe(p0.templates[0]?.id);
  });
});
