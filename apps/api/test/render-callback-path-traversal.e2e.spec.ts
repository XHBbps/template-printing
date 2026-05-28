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

// Spy that records every uploadMaterial call. The render-callback handler must
// NOT call this for a path-traversal pdfUrl — it should reject before fs.readFile.
const uploadMaterialCalls: unknown[] = [];
const updateRecordCalls: unknown[] = [];

const larkBitableMock = {
  updateRecord: async (args: unknown) => {
    updateRecordCalls.push(args);
    return { ok: true };
  },
  uploadMaterial: async (args: unknown) => {
    uploadMaterialCalls.push(args);
    return 'spy_file_token';
  },
  // not used by the callback path but present on the real service
  createBitableRecord: async () => ({ ok: true }),
};

describe('Render callback pdfUrl path traversal (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  const OWNER = 'e2e_rcpt_owner';
  const PW = 'pw-e2e-rcpt-1';
  const BITABLE_TOKEN = 'e2e-rcpt-bitable-token';

  let bitableJobId: string;

  beforeAll(async () => {
    // Token must match what the controller reads at request time.
    process.env.LARK_BITABLE_VERIFICATION_TOKEN = BITABLE_TOKEN;

    await prisma.user.deleteMany({ where: { localUsername: { in: [OWNER] } } });
    const owner = await prisma.user.create({
      data: {
        localUsername: OWNER,
        localPasswordHash: await bcrypt.hash(PW, 10),
        role: 'user',
        mustChangePassword: false,
        name: 'RCPT Owner',
      },
    });

    const tpl = await prisma.template.create({
      data: {
        name: 'rcpt-template',
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

    // Seed the LarkPrintRequest so the bitable handler proceeds past the
    // findUnique null-guard and into the file-read branch.
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
    const ids = (
      await prisma.user.findMany({
        where: { localUsername: { in: [OWNER] } },
        select: { id: true },
      })
    ).map((u) => u.id);
    // larkPrintRequest cascades from renderJob; renderJob cascades from template.
    await prisma.larkPrintRequest.deleteMany({ where: { renderJobId: bitableJobId } });
    await prisma.renderJob.deleteMany({ where: { id: bitableJobId } });
    await prisma.template.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.user.deleteMany({ where: { localUsername: { in: [OWNER] } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('bitable render-callback rejects a path-traversal pdfUrl and never reads/uploads the file', async () => {
    uploadMaterialCalls.length = 0;
    updateRecordCalls.length = 0;

    const res = await request(app.getHttpServer())
      .post('/lark/render-callback')
      .query({ token: BITABLE_TOKEN })
      .send({
        jobId: bitableJobId,
        status: 'done',
        pdfUrl: '/../../../../etc/hostname',
      });

    // The handler ack's with 200 (errors are caught and routed to markFailed),
    // but the guard must prevent the traversal file from being read & uploaded.
    expect(res.status).toBe(200);

    // CORE ASSERTION: no file content was uploaded to Lark from the traversal path.
    expect(uploadMaterialCalls).toHaveLength(0);

    // The request row must be marked failed with the guard's error message.
    const req = await prisma.larkPrintRequest.findUnique({
      where: { renderJobId: bitableJobId },
    });
    expect(req?.callbackStatus).toBe('failed');
    expect(req?.errorMsg).toContain('invalid_pdf_path');
  });
});
