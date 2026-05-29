/**
 * e2e: 飞书回调收到带签名 query 的 pdfUrl(/uploads/render/<id>.pdf?token=...)时,
 * 必须先去掉 query 再拼本地路径,否则文件名含 ?token → ENOENT,PDF 写回失败。
 * (worker webhook.ts 调 signUrl 给回调 pdfUrl 加 token;FILE_SIG_SECRET 配了就会签。)
 */
// 在导入任何源码模块前固化 STORAGE_ROOT 为绝对路径(源码 module-level 常量在 import 时取值)。
// eslint-disable-next-line @typescript-eslint/no-var-requires
process.env.STORAGE_ROOT = require('node:path').resolve(
  process.env.STORAGE_ROOT ?? './.test-storage',
);
process.env.LARK_BOT_VERIFICATION_TOKEN = 'bot-tok-signedurl-aaaaaaaa';
process.env.LARK_BITABLE_VERIFICATION_TOKEN = 'bit-tok-signedurl-bbbbbbbb';
process.env.RENDER_CALLBACK_SECRET = 'cb-secret-signedurl-cccccccc';

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBitableService } from '../src/lark/lark-bitable.service.js';
// eslint-disable-next-line import/no-unresolved
import { LarkBotService } from '../src/lark/lark-bot.service.js';

const STORAGE_ROOT = process.env.STORAGE_ROOT as string;
const RENDER_DIR = path.join(STORAGE_ROOT, 'uploads', 'render');
const BOT_TOKEN = 'bot-tok-signedurl-aaaaaaaa';
const CB_SECRET = 'cb-secret-signedurl-cccccccc';

const uploadIMFile = jest.fn(async () => 'file_key_bot');
const sendFileMessage = jest.fn(async () => undefined);
const sendTextWithMention = jest.fn(async () => undefined);
const updateCard = jest.fn(async () => undefined);
const larkBotMock = { uploadIMFile, sendFileMessage, sendTextWithMention, updateCard };

const uploadMaterial = jest.fn(async () => 'file_token_bit');
const updateRecord = jest.fn(async () => ({ ok: true }));
const larkBitableMock = {
  uploadMaterial,
  updateRecord,
  createBitableRecord: async () => ({ ok: true }),
};

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

describe('飞书回调:签名 pdfUrl 去 query 后读文件 (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const OWNER = 'e2e_signedurl_owner';
  let templateId: string;
  let botJobId: string;
  let bitJobId: string;

  beforeAll(async () => {
    await fs.mkdir(RENDER_DIR, { recursive: true });
    await prisma.user.deleteMany({ where: { localUsername: OWNER } });
    const owner = await prisma.user.create({
      data: { localUsername: OWNER, role: 'user', name: 'SignedUrl Owner' },
    });
    const tpl = await prisma.template.create({
      data: {
        name: 'signedurl-tpl',
        data: VER_DATA,
        ownerId: owner.id,
        visibility: 'private',
        publishedVersion: 1,
      },
    });
    templateId = tpl.id;

    // bot 路径:done job + rendering 会话 + 真实 PDF 文件
    const botJob = await prisma.renderJob.create({
      data: { templateId, data: {}, formats: ['pdf'], status: 'done' },
    });
    botJobId = botJob.id;
    await prisma.larkBotSession.create({
      data: {
        chatId: 'oc_su',
        chatType: 'p2p',
        triggerOpenId: 'ou_su',
        templateId,
        renderJobId: botJob.id,
        state: 'rendering',
      },
    });
    await fs.writeFile(path.join(RENDER_DIR, `${botJobId}.pdf`), Buffer.from('%PDF-1.4 bot'));

    // bitable 路径:done job + pending print-request + 真实 PDF 文件
    const bitJob = await prisma.renderJob.create({
      data: { templateId, data: {}, formats: ['pdf'], status: 'done' },
    });
    bitJobId = bitJob.id;
    await prisma.larkPrintRequest.create({
      data: {
        renderJobId: bitJob.id,
        appToken: 'app_su',
        tableId: 'tbl_su',
        recordId: 'rec_su',
        statusField: '状态',
        attachmentField: '附件',
        callbackStatus: 'pending',
      },
    });
    await fs.writeFile(path.join(RENDER_DIR, `${bitJobId}.pdf`), Buffer.from('%PDF-1.4 bit'));

    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LarkBotService)
      .useValue(larkBotMock)
      .overrideProvider(LarkBitableService)
      .useValue(larkBitableMock)
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await prisma.larkBotSession.deleteMany({ where: { renderJobId: botJobId } });
    await prisma.larkPrintRequest.deleteMany({ where: { renderJobId: bitJobId } });
    await prisma.renderJob.deleteMany({ where: { id: { in: [botJobId, bitJobId] } } });
    await prisma.template.deleteMany({ where: { id: templateId } });
    await prisma.user.deleteMany({ where: { localUsername: OWNER } });
    await fs.rm(path.join(RENDER_DIR, `${botJobId}.pdf`), { force: true }).catch(() => {});
    await fs.rm(path.join(RENDER_DIR, `${bitJobId}.pdf`), { force: true }).catch(() => {});
    await prisma.$disconnect();
    await app.close();
  });

  it('bot:签名 pdfUrl → 去 query 读到文件 → 上传 IM(非 ENOENT)', async () => {
    uploadIMFile.mockClear();
    const signed = `/uploads/render/${botJobId}.pdf?token=deadbeef.1780000000`;
    const res = await request(app.getHttpServer())
      .post('/lark/bot/render-callback')
      .query({ token: BOT_TOKEN })
      .send({ jobId: botJobId, status: 'done', pdfUrl: signed });
    expect(res.status).toBe(200);
    expect(uploadIMFile).toHaveBeenCalledTimes(1); // 读到文件才会上传;ENOENT 时不会
    const session = await prisma.larkBotSession.findUnique({ where: { renderJobId: botJobId } });
    expect(session?.state).toBe('done');
  });

  it('bitable:签名 pdfUrl → 去 query 读到文件 → 上传素材(非 ENOENT)', async () => {
    uploadMaterial.mockClear();
    const signed = `/uploads/render/${bitJobId}.pdf?token=deadbeef.1780000000`;
    const res = await request(app.getHttpServer())
      .post('/lark/render-callback')
      .query({ token: CB_SECRET })
      .send({ jobId: bitJobId, status: 'done', pdfUrl: signed });
    expect(res.status).toBe(200);
    expect(uploadMaterial).toHaveBeenCalledTimes(1);
    const req = await prisma.larkPrintRequest.findUnique({ where: { renderJobId: bitJobId } });
    expect(req?.callbackStatus).toBe('done');
  });
});
