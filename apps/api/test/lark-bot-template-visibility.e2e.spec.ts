import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBotController } from '../src/lark/lark-bot.controller.js';

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
  let controller: LarkBotController;
  const prisma = new PrismaClient();
  const OWNER = 'e2e_larkvis_owner';
  const PW = 'pw-e2e-larkvis-1';
  let publicPublishedId: string;
  let privatePublishedId: string;
  let publicUnpublishedId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: { in: [OWNER] } } });
    const owner = await prisma.user.create({
      data: {
        localUsername: OWNER,
        localPasswordHash: await bcrypt.hash(PW, 10),
        role: 'user',
        mustChangePassword: false,
        name: 'Lark Vis Owner',
      },
    });

    // (1) public + published → MUST appear
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

    // (2) private + published → MUST NOT appear
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

    // (3) public + unpublished → MUST NOT appear
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
    controller = app.get(LarkBotController);
  });

  afterAll(async () => {
    const ids = (
      await prisma.user.findMany({
        where: { localUsername: { in: [OWNER] } },
        select: { id: true },
      })
    ).map((u) => u.id);
    await prisma.template.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.user.deleteMany({ where: { localUsername: { in: [OWNER] } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('listBotTemplates returns ONLY public+published templates', async () => {
    const templates = await controller.listBotTemplates();
    const ids = templates.map((t) => t.id);
    expect(ids).toContain(publicPublishedId);
    expect(ids).not.toContain(privatePublishedId);
    expect(ids).not.toContain(publicUnpublishedId);
  });
});
