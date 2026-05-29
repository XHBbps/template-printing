/**
 * e2e: 孤儿上传图片清理 cron（批次3 存储清理 Task 2，P1）
 *
 * 上传图片内容寻址写到 STORAGE_ROOT/uploads/<sha256>.<ext>，URL /uploads/<file>
 * 被嵌入 templates.data / template_versions.data。删模板/版本不删磁盘文件 →
 * uploads 顶层无限增长。cleanupOrphanUploads 扫顶层文件，删「无引用 且 mtime
 * 早于 UPLOAD_ORPHAN_GRACE_DAYS（默认7）」者；render/ 子目录（渲染产物）不动。
 *
 * 断言：
 *   1. <tag>-keep.png 存在（被模板 data 引用）；
 *   2. <tag>-orphan.png 已删（无引用 + mtime 30 天前 > 宽限期）；
 *   3. <tag>-recent.png 存在（无引用但 mtime 现在 → 宽限期内不删）；
 *   4. uploads/render/<tag>-subdir-guard.pdf 存在（子目录文件不被扫到）。
 *
 * 路径全部从 process.env.STORAGE_ROOT 推导，且在导入任何源码模块之前把它规整成
 * 绝对路径，确保测试写文件的基准目录与服务 module-level STORAGE_ROOT 捕获的同一个。
 */
// 与 render-dir-fix.e2e.spec.ts 同款：在导入任何源码模块（其 module-level 常量在
// import 时即固化 STORAGE_ROOT）之前，把它规整成绝对路径。放在所有 import 之前以保证
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
import { AppModule } from '../src/app.module.js';
// eslint-disable-next-line import/no-unresolved
import { RenderCleanupService } from '../src/render/render-cleanup.service.js';

// 与源码 module-level 常量同款解析
const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '/storage';
const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');
const RENDER_DIR = path.join(UPLOADS_DIR, 'render');

// 唯一前缀，避免与脏测试库里既有模板的文件名冲突
const tag = 'orphantest-' + Date.now();
const KEEP_FILE = `${tag}-keep.png`;
const ORPHAN_FILE = `${tag}-orphan.png`;
const RECENT_FILE = `${tag}-recent.png`;
const SUBDIR_FILE = `${tag}-subdir-guard.pdf`;
// review 第 7 节 #3:确认引用扫描正则 /\/uploads\/([A-Za-z0-9._-]+)/ 对"非 /uploads/ 开头"
// 的存储形态(绝对 URL / 带 query string)是否漏算导致误删。这两个文件 mtime 设 30 天前
// (超宽限期),若正则漏算就会被当孤儿删除 —— 断言它们存活即证明不漏算。
const KEEP_ABS_FILE = `${tag}-keep-abs.png`; // 模板里以 https://cdn/uploads/<file> 绝对 URL 引用
const KEEP_QS_FILE = `${tag}-keep-qs.png`; // 模板里以 /uploads/<file>?v=2 带 query 引用

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe('orphan uploads cleanup (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let ownerId: string;
  let templateId: string;

  beforeAll(async () => {
    await fs.mkdir(RENDER_DIR, { recursive: true });

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();

    // Template → owner User（FK）
    await prisma.user.deleteMany({ where: { localUsername: 'e2e_orphan_uploads_owner' } });
    const owner = await prisma.user.create({
      data: {
        localUsername: 'e2e_orphan_uploads_owner',
        role: 'user',
        name: 'Orphan Uploads Owner',
      },
    });
    ownerId = owner.id;

    // data 含 /uploads/<KEEP_FILE> → 引用集命中（cleanup 只扫 data::text，不校验 schema）
    const tpl = await prisma.template.create({
      data: {
        name: 'e2e orphan-uploads tpl',
        data: {
          elements: [
            { type: 'image', url: `/uploads/${KEEP_FILE}` },
            // 绝对 URL 形态:正则非锚定,应仍能命中其中的 /uploads/<file> 子串
            { type: 'image', url: `https://cdn.example.com/uploads/${KEEP_ABS_FILE}` },
            // 带 query string 形态:[A-Za-z0-9._-]+ 在 '?' 处停止,捕获到纯文件名
            { type: 'image', url: `/uploads/${KEEP_QS_FILE}?v=2` },
          ],
        },
        ownerId: owner.id,
      },
    });
    templateId = tpl.id;

    // 造顶层文件 + 一个子目录文件
    await fs.writeFile(path.join(UPLOADS_DIR, KEEP_FILE), Buffer.from('keep-png'));
    await fs.writeFile(path.join(UPLOADS_DIR, ORPHAN_FILE), Buffer.from('orphan-png'));
    await fs.writeFile(path.join(UPLOADS_DIR, RECENT_FILE), Buffer.from('recent-png'));
    await fs.writeFile(path.join(UPLOADS_DIR, KEEP_ABS_FILE), Buffer.from('keep-abs-png'));
    await fs.writeFile(path.join(UPLOADS_DIR, KEEP_QS_FILE), Buffer.from('keep-qs-png'));
    await fs.writeFile(path.join(RENDER_DIR, SUBDIR_FILE), Buffer.from('%PDF-1.4 subdir'));

    // orphan + 两个被引用文件的 mtime 都设 30 天前(超宽限期)。
    // orphan 应被删;两个被引用的(绝对URL / query)应存活 —— 证明正则不漏算。
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000);
    await fs.utimes(path.join(UPLOADS_DIR, ORPHAN_FILE), thirtyDaysAgo, thirtyDaysAgo);
    await fs.utimes(path.join(UPLOADS_DIR, KEEP_ABS_FILE), thirtyDaysAgo, thirtyDaysAgo);
    await fs.utimes(path.join(UPLOADS_DIR, KEEP_QS_FILE), thirtyDaysAgo, thirtyDaysAgo);
  });

  afterAll(async () => {
    if (templateId) await prisma.template.deleteMany({ where: { id: templateId } });
    if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
    // 删残留测试文件（best-effort，含子目录那个）
    await fs.rm(path.join(UPLOADS_DIR, KEEP_FILE), { force: true }).catch(() => {});
    await fs.rm(path.join(UPLOADS_DIR, ORPHAN_FILE), { force: true }).catch(() => {});
    await fs.rm(path.join(UPLOADS_DIR, RECENT_FILE), { force: true }).catch(() => {});
    await fs.rm(path.join(UPLOADS_DIR, KEEP_ABS_FILE), { force: true }).catch(() => {});
    await fs.rm(path.join(UPLOADS_DIR, KEEP_QS_FILE), { force: true }).catch(() => {});
    await fs.rm(path.join(RENDER_DIR, SUBDIR_FILE), { force: true }).catch(() => {});
    await app.close();
  });

  it('keeps referenced & recent files, deletes only old unreferenced top-level files, leaves render/ subdir untouched', async () => {
    await app.get(RenderCleanupService).cleanupOrphanUploads();

    // 1. 被模板引用 → 保留
    expect(await exists(path.join(UPLOADS_DIR, KEEP_FILE))).toBe(true);
    // 2. 无引用 + 30 天前 → 已删
    expect(await exists(path.join(UPLOADS_DIR, ORPHAN_FILE))).toBe(false);
    // 3. 无引用但宽限期内 → 保留
    expect(await exists(path.join(UPLOADS_DIR, RECENT_FILE))).toBe(true);
    // 4. render/ 子目录文件 → 不被扫到，保留
    expect(await exists(path.join(RENDER_DIR, SUBDIR_FILE))).toBe(true);
  });

  it('#3 引用扫描正则不漏算:绝对 URL / 带 query 引用的旧文件仍被保留(非误删)', async () => {
    // cleanup 已在上个用例跑过;两个被引用文件(mtime 30 天前)若被正则漏算就会在那次被删。
    // 绝对 URL https://cdn/uploads/<file>:正则非锚定,命中 /uploads/<file> 子串 → 保留。
    expect(await exists(path.join(UPLOADS_DIR, KEEP_ABS_FILE))).toBe(true);
    // /uploads/<file>?v=2:捕获组 [A-Za-z0-9._-]+ 到 '?' 停止 → 纯文件名命中 → 保留。
    expect(await exists(path.join(UPLOADS_DIR, KEEP_QS_FILE))).toBe(true);
  });
});
