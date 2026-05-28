/**
 * e2e: 审计日志保留清理 cron 回归测试（批次3 存储清理 Task 3 / P2）
 *
 * AuditLog 表只增不减 → 无限增长。RenderCleanupService.cleanupAuditLog() 删
 * createdAt 早于 AUDIT_LOG_RETENTION_DAYS（默认 90，≤0 关）的行。
 *
 * 本测试用真实 prisma 插两条 auditLog：
 *   ① createdAt 设 120 天前（旧，应被删）；
 *   ② createdAt 现在（新，应保留）。
 * 设 AUDIT_LOG_RETENTION_DAYS='90'（方法调用时读 process.env），调 cleanupAuditLog()，
 * 断言：旧行被删、新行仍在。
 *
 * 用唯一 action 标识（'test.auditcleanup.<old|recent>.' + 同一时间戳）隔离，
 * afterAll 仅删自己造的行，绝不误删库里其它真实 auditLog。
 */
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

// 唯一标识：同一 run 共享时间戳后缀，afterAll 精确定位
const RUN = Date.now();
const OLD_ACTION = `test.auditcleanup.old.${RUN}`;
const RECENT_ACTION = `test.auditcleanup.recent.${RUN}`;

describe('audit-log retention cleanup (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();

    // ① 120 天前（旧）— 必命中 90 天保留期
    await prisma.auditLog.create({
      data: {
        action: OLD_ACTION,
        createdAt: new Date(Date.now() - 120 * 86400 * 1000),
      },
    });
    // ② 现在（新）— 不传 createdAt 走 @default(now())
    await prisma.auditLog.create({
      data: { action: RECENT_ACTION },
    });
  });

  afterAll(async () => {
    // 新那条仍在 → 精确删；旧那条已被清理（best-effort 兜底删一次）
    await prisma.auditLog.deleteMany({ where: { action: { in: [OLD_ACTION, RECENT_ACTION] } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('deletes audit rows older than AUDIT_LOG_RETENTION_DAYS, keeps recent ones', async () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = '90';

    await app.get(RenderCleanupService).cleanupAuditLog();

    const oldRow = await prisma.auditLog.findFirst({ where: { action: OLD_ACTION } });
    const recentRow = await prisma.auditLog.findFirst({ where: { action: RECENT_ACTION } });

    expect(oldRow).toBeNull(); // 旧行被删
    expect(recentRow).not.toBeNull(); // 新行保留
  });
});
