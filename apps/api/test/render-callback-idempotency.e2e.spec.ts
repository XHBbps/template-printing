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

// Set BEFORE bootstrap so the controllers read the right values at request time.
process.env.RENDER_CALLBACK_SECRET = 'cb-secret-idem-aaaaaaaa';
process.env.LARK_BOT_VERIFICATION_TOKEN = 'bot-token-idem-bbbbbbbb';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBitableService } from '../src/lark/lark-bitable.service.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBotService } from '../src/lark/lark-bot.service.js';

const CALLBACK_SECRET = 'cb-secret-idem-aaaaaaaa';
const BOT_TOKEN = 'bot-token-idem-bbbbbbbb';

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

// Spy doubles — if any of these get called, the idempotency guard failed.
const uploadMaterial = jest.fn(async () => 'spy_file_token');
const updateRecord = jest.fn(async () => ({ ok: true }));
const larkBitableMock = {
  uploadMaterial,
  updateRecord,
  createBitableRecord: async () => ({ ok: true }),
};

const uploadIMFile = jest.fn(async () => 'spy_file_key');
const sendFileMessage = jest.fn(async () => undefined);
const sendTextWithMention = jest.fn(async () => undefined);
const updateCard = jest.fn(async () => undefined);
const larkBotMock = {
  uploadIMFile,
  sendFileMessage,
  sendTextWithMention,
  updateCard,
};

describe('Render callback idempotency (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  const OWNER = 'e2e_rci_owner';
  const PW = 'pw-e2e-rci-1';

  let bitableJobId: string;
  let botJobId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { localUsername: { in: [OWNER] } } });
    const owner = await prisma.user.create({
      data: {
        localUsername: OWNER,
        localPasswordHash: await bcrypt.hash(PW, 10),
        role: 'user',
        mustChangePassword: false,
        name: 'RCI Owner',
      },
    });

    const tpl = await prisma.template.create({
      data: {
        name: 'rci-template',
        data: VER_DATA,
        ownerId: owner.id,
        visibility: 'private',
        publishedVersion: 1,
      },
    });

    // --- bitable path: a job whose LarkPrintRequest already succeeded ---
    const bitableJob = await prisma.renderJob.create({
      data: { templateId: tpl.id, data: {}, formats: ['pdf'], status: 'done' },
    });
    bitableJobId = bitableJob.id;
    await prisma.larkPrintRequest.create({
      data: {
        renderJobId: bitableJob.id,
        appToken: 'app_token_x',
        tableId: 'table_x',
        recordId: 'record_x',
        statusField: '状态',
        attachmentField: '附件',
        // Already successfully written back → handler must idempotently short-circuit.
        callbackStatus: 'done',
      },
    });

    // --- bot path: a session that already reached 'done' ---
    const botJob = await prisma.renderJob.create({
      data: { templateId: tpl.id, data: {}, formats: ['pdf'], status: 'done' },
    });
    botJobId = botJob.id;
    await prisma.larkBotSession.create({
      data: {
        chatId: 'chat_x',
        chatType: 'p2p',
        triggerOpenId: 'ou_x',
        templateId: tpl.id,
        renderJobId: botJob.id,
        // Already done → handler must idempotently short-circuit.
        state: 'done',
      },
    });

    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LarkBitableService)
      .useValue(larkBitableMock)
      .overrideProvider(LarkBotService)
      .useValue(larkBotMock)
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await prisma.larkPrintRequest.deleteMany({ where: { renderJobId: bitableJobId } });
    await prisma.larkBotSession.deleteMany({ where: { renderJobId: botJobId } });
    await prisma.renderJob.deleteMany({ where: { id: { in: [bitableJobId, botJobId] } } });
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

  it('bitable: already-done callbackStatus short-circuits without re-uploading PDF / re-writing record', async () => {
    uploadMaterial.mockClear();
    updateRecord.mockClear();

    const res = await request(app.getHttpServer())
      .post('/lark/render-callback')
      .query({ token: CALLBACK_SECRET })
      .send({
        jobId: bitableJobId,
        status: 'done',
        pdfUrl: `/uploads/render/${bitableJobId}.pdf`,
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(uploadMaterial).toHaveBeenCalledTimes(0);
    expect(updateRecord).toHaveBeenCalledTimes(0);
  });

  it('bot: already-done session.state short-circuits without re-uploading / re-sending file', async () => {
    uploadIMFile.mockClear();
    sendFileMessage.mockClear();
    sendTextWithMention.mockClear();

    const res = await request(app.getHttpServer())
      .post('/lark/bot/render-callback')
      .query({ token: BOT_TOKEN })
      .send({
        jobId: botJobId,
        status: 'done',
        pdfUrl: `/uploads/render/${botJobId}.pdf`,
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(uploadIMFile).toHaveBeenCalledTimes(0);
    expect(sendFileMessage).toHaveBeenCalledTimes(0);
    expect(sendTextWithMention).toHaveBeenCalledTimes(0);
  });
});
