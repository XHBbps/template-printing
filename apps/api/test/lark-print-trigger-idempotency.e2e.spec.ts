// eslint-disable-next-line import/no-unresolved
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
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

// 必须在 bootstrap 前设置,controller 在请求时读 process.env。
process.env.LARK_BITABLE_VERIFICATION_TOKEN = 'bitable-token-idem-cccccccc';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBitableService } from '../src/lark/lark-bitable.service.js';

const VERIFICATION_TOKEN = 'bitable-token-idem-cccccccc';

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

// updateRecord 是 fire-and-forget,mock 掉避免打真实飞书 API。
const updateRecord = jest.fn(async () => ({ ok: true }));
const uploadMaterial = jest.fn(async () => 'spy_file_token');
const larkBitableMock = {
  updateRecord,
  uploadMaterial,
  createBitableRecord: async () => ({ ok: true }),
};

describe('Lark print-trigger record 级幂等 (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  const OWNER = 'e2e_pti_owner';
  const PW = 'pw-e2e-pti-1';
  const APP_TOKEN = 'app_token_pti';
  const TABLE_ID = 'table_pti';
  const RECORD_ID = 'record_pti';
  let templateId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: OWNER } });
    const owner = await prisma.user.create({
      data: {
        localUsername: OWNER,
        localPasswordHash: await bcrypt.hash(PW, 10),
        role: 'user',
        mustChangePassword: false,
        name: 'PTI Owner',
      },
    });
    const tpl = await prisma.template.create({
      data: {
        name: 'pti-template',
        data: VER_DATA,
        ownerId: owner.id,
        visibility: 'private',
        publishedVersion: 1,
      },
    });
    templateId = tpl.id;

    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LarkBitableService)
      .useValue(larkBitableMock)
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await prisma.larkPrintRequest.deleteMany({ where: { appToken: APP_TOKEN } });
    await prisma.renderJob.deleteMany({ where: { templateId } });
    await prisma.template.deleteMany({ where: { id: templateId } });
    await prisma.user.deleteMany({ where: { localUsername: OWNER } });
    await prisma.$disconnect();
    await app.close();
  });

  it('重复(重投/连点)两次相同 print-trigger → 复用同一 job,只入队一次', async () => {
    const payload = {
      verificationToken: VERIFICATION_TOKEN,
      templateId,
      data: { foo: 'bar' },
      lark: {
        appToken: APP_TOKEN,
        tableId: TABLE_ID,
        recordId: RECORD_ID,
        statusField: '状态',
        attachmentField: '附件',
      },
    };

    const r1 = await request(app.getHttpServer())
      .post('/lark/print-trigger')
      .send(payload)
      .expect(200);
    const r2 = await request(app.getHttpServer())
      .post('/lark/print-trigger')
      .send(payload)
      .expect(200);

    // 第二次复用第一次的 jobId
    expect(r1.body.jobId).toBeTruthy();
    expect(r2.body.jobId).toBe(r1.body.jobId);

    // DB 只产生一行 LarkPrintRequest + 一个 RenderJob
    const reqs = await prisma.larkPrintRequest.findMany({
      where: { appToken: APP_TOKEN, tableId: TABLE_ID, recordId: RECORD_ID },
    });
    expect(reqs.length).toBe(1);
    const jobs = await prisma.renderJob.findMany({ where: { templateId } });
    expect(jobs.length).toBe(1);
  });

  it('上一请求已 done → 不挡,允许重新打印(产生新 job)', async () => {
    // 把现有 pending 行标 done,模拟一次打印已完成
    await prisma.larkPrintRequest.updateMany({
      where: { appToken: APP_TOKEN, tableId: TABLE_ID, recordId: RECORD_ID },
      data: { callbackStatus: 'done' },
    });

    const payload = {
      verificationToken: VERIFICATION_TOKEN,
      templateId,
      data: {},
      lark: {
        appToken: APP_TOKEN,
        tableId: TABLE_ID,
        recordId: RECORD_ID,
        statusField: '状态',
        attachmentField: '附件',
      },
    };
    const r = await request(app.getHttpServer())
      .post('/lark/print-trigger')
      .send(payload)
      .expect(200);

    const jobs = await prisma.renderJob.findMany({ where: { templateId } });
    // 第一个测试 1 个 + 本次新 1 个 = 2
    expect(jobs.length).toBe(2);
    expect(jobs.map((j) => j.id)).toContain(r.body.jobId);
  });
});
