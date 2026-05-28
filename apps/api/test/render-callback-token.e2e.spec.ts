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
import request from 'supertest';

// Set BEFORE bootstrap so the controller reads the right values at request time.
// The internal render-callback secret is DISTINCT from the external webhook token.
process.env.RENDER_CALLBACK_SECRET = 'cb-secret-aaaaaaaaaaaa';
process.env.LARK_BITABLE_VERIFICATION_TOKEN = 'wh-token-bbbbbbbbbbbb';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBitableService } from '../src/lark/lark-bitable.service.js';

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

const larkBitableMock = {
  updateRecord: async () => ({ ok: true }),
  uploadMaterial: async () => 'spy_file_token',
  createBitableRecord: async () => ({ ok: true }),
};

const WEBHOOK_TOKEN = 'wh-token-bbbbbbbbbbbb';
const CALLBACK_SECRET = 'cb-secret-aaaaaaaaaaaa';

describe('Render callback token separation (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  const OWNER = 'e2e_rct_owner';
  const PW = 'pw-e2e-rct-1';

  let bitableJobId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: { in: [OWNER] } } });
    const owner = await prisma.user.create({
      data: {
        localUsername: OWNER,
        localPasswordHash: await bcrypt.hash(PW, 10),
        role: 'user',
        mustChangePassword: false,
        name: 'RCT Owner',
      },
    });

    const tpl = await prisma.template.create({
      data: {
        name: 'rct-template',
        data: VER_DATA,
        ownerId: owner.id,
        visibility: 'private',
        publishedVersion: 1,
      },
    });

    const job = await prisma.renderJob.create({
      data: {
        templateId: tpl.id,
        data: {},
        formats: ['pdf'],
        status: 'done',
      },
    });
    bitableJobId = job.id;

    // Seed a LarkPrintRequest so the handler proceeds past the findUnique guard.
    await prisma.larkPrintRequest.create({
      data: {
        renderJobId: job.id,
        appToken: 'app_token_x',
        tableId: 'table_x',
        recordId: 'record_x',
        statusField: '状态',
        attachmentField: '附件',
        callbackStatus: 'pending',
      },
    });

    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LarkBitableService)
      .useValue(larkBitableMock)
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await prisma.larkPrintRequest.deleteMany({ where: { renderJobId: bitableJobId } });
    await prisma.renderJob.deleteMany({ where: { id: bitableJobId } });
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

  it('rejects the external WEBHOOK token for the internal render-callback (401)', async () => {
    const res = await request(app.getHttpServer())
      .post('/lark/render-callback')
      .query({ token: WEBHOOK_TOKEN })
      .send({ jobId: bitableJobId, status: 'failed', errorMsg: 'x' });

    expect(res.status).toBe(401);
  });

  it('accepts the dedicated RENDER_CALLBACK_SECRET for the internal callback (not 401)', async () => {
    const res = await request(app.getHttpServer())
      .post('/lark/render-callback')
      .query({ token: CALLBACK_SECRET })
      // status:'failed' avoids needing a real pdf file on disk; we only assert
      // the request passed the token gate (i.e. NOT 401).
      .send({ jobId: bitableJobId, status: 'failed', errorMsg: 'x' });

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });
});
