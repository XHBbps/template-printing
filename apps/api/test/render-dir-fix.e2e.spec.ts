/**
 * e2e: RENDER_DIR 漏 uploads/ 段 bug 修复回归测试（批次3 存储清理 Task 1）
 *
 * 渲染产物实际落在 STORAGE_ROOT/uploads/render/，但 signed-uploads.controller
 * 与 render-cleanup.service 里的 RENDER_DIR 误写成 STORAGE_ROOT/render/。后果：
 *   (a) 签名下载从错误目录找文件 → 404；
 *   (b) 清理 cron 去 unlink 错误路径 → ENOENT 被吞 → 真产物永不清。
 *
 * 本测试把产物写到正确目录（STORAGE_ROOT/uploads/render/），并断言：
 *   1. 签名下载 GET → 200（修复前 404）；
 *   2. 清理后真产物文件被删（修复前残留）。
 *
 * 路径全部从 process.env.STORAGE_ROOT 推导（.env.test 把它设为 ./.test-storage），
 * 不硬编码 /storage，以对齐源码 module-level 常量的解析方式。
 */
// .env.test 把 STORAGE_ROOT 设成相对路径 (./.test-storage)，而 express res.sendFile
// 要求绝对路径（否则 500）。这里在导入任何源码模块（其 RENDER_DIR 在 import 时即固化）
// 之前把它规整成绝对路径，模拟生产环境的 /storage 绝对根。放在所有 import 之前以保证
// 它先于源码模块的 module-level 常量求值执行（jest setupFiles 已加载 .env.test）。
// eslint-disable-next-line @typescript-eslint/no-var-requires
process.env.STORAGE_ROOT = require('node:path').resolve(process.env.STORAGE_ROOT ?? '/storage');

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// eslint-disable-next-line import/no-unresolved
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
// eslint-disable-next-line import/no-unresolved
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { Test } from '@nestjs/testing';
// eslint-disable-next-line import/no-unresolved
import { PrismaClient } from '@prisma/client';
// eslint-disable-next-line import/no-unresolved
import request from 'supertest';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from '../src/app.module.js';
// eslint-disable-next-line import/no-unresolved
import { RenderCleanupService } from '../src/render/render-cleanup.service.js';
// eslint-disable-next-line import/no-unresolved
import { FileSigService } from '../src/uploads/file-sig.service.js';

// 与源码 module-level 常量同款解析：fixed RENDER_DIR = STORAGE_ROOT/uploads/render
const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '/storage';
const RENDER_DIR = path.join(STORAGE_ROOT, 'uploads', 'render');

const SIG_FILE = 'sigtest.pdf';
const CLEAN_FILE = 'cleantest.pdf';

describe('RENDER_DIR uploads/ path fix (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let ownerId: string;
  let templateId: string;
  let cleanJobId: string;

  beforeAll(async () => {
    // 确保正确产物目录存在
    await fs.mkdir(RENDER_DIR, { recursive: true });

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();

    // RenderJob 有 FK 到 Template，Template 有 FK 到 owner User → 先造最小依赖
    await prisma.user.deleteMany({ where: { localUsername: 'e2e_render_dir_owner' } });
    const owner = await prisma.user.create({
      data: { localUsername: 'e2e_render_dir_owner', role: 'user', name: 'Render Dir Owner' },
    });
    ownerId = owner.id;

    const tpl = await prisma.template.create({
      data: { name: 'e2e render-dir-fix tpl', data: {}, ownerId: owner.id },
    });
    templateId = tpl.id;
  });

  afterAll(async () => {
    // 删造的数据
    if (templateId) await prisma.renderJob.deleteMany({ where: { templateId } });
    if (templateId) await prisma.template.deleteMany({ where: { id: templateId } });
    if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
    // 删残留测试文件（best-effort）
    await fs.rm(path.join(RENDER_DIR, SIG_FILE), { force: true }).catch(() => {});
    await fs.rm(path.join(RENDER_DIR, CLEAN_FILE), { force: true }).catch(() => {});
    await app.close();
  });

  it('signed download serves a file from STORAGE_ROOT/uploads/render → 200', async () => {
    const filePath = path.join(RENDER_DIR, SIG_FILE);
    await fs.writeFile(filePath, Buffer.from('%PDF-1.4 sigtest'));

    try {
      // signUrl 返完整相对路径 + ?token=<hex>.<unix>，可直接喂 supertest
      const signed = app.get(FileSigService).signUrl(`/uploads/render/${SIG_FILE}`);
      expect(signed).toBeTruthy();

      const res = await request(app.getHttpServer()).get(signed as string);
      // 修复前 RENDER_DIR=STORAGE_ROOT/render → 文件不在那 → 404；修复后 200
      expect(res.status).toBe(200);
    } finally {
      await fs.rm(filePath, { force: true }).catch(() => {});
    }
  });

  it('cleanupOldOutputs deletes the real artifact at STORAGE_ROOT/uploads/render and marks cleanedAt', async () => {
    const filePath = path.join(RENDER_DIR, CLEAN_FILE);
    await fs.writeFile(filePath, Buffer.from('%PDF-1.4 cleantest'));

    // 60 天前的 done job → RENDER_CLEANUP_DAYS 默认 30，必命中
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400 * 1000);
    const job = await prisma.renderJob.create({
      data: {
        templateId,
        data: {},
        formats: ['pdf'],
        status: 'done',
        createdAt: sixtyDaysAgo,
        pdfUrl: `/uploads/render/${CLEAN_FILE}`,
      },
    });
    cleanJobId = job.id;

    await app.get(RenderCleanupService).cleanupOldOutputs();

    // 修复前 unlink STORAGE_ROOT/render/cleantest.pdf（不存在）→ ENOENT 吞 → 真文件残留
    let fileExists = true;
    try {
      await fs.access(filePath);
    } catch {
      fileExists = false;
    }
    expect(fileExists).toBe(false);

    const refreshed = await prisma.renderJob.findUnique({ where: { id: cleanJobId } });
    expect(refreshed).not.toBeNull();
    expect(refreshed!.cleanedAt).not.toBeNull();
  });
});
