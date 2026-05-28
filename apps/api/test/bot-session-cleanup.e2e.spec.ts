/**
 * e2e: 飞书机器人会话保留清理 cron 回归测试（批次3 存储清理 Task 4 / P12）
 *
 * LarkBotSession 表已终态(done/failed)的旧会话只增不减 → 无限增长。
 * RenderCleanupService.cleanupBotSessions() 删 state in (done,failed) 且
 * updatedAt 早于 BOT_SESSION_RETENTION_DAYS（默认 30，≤0 关）的行；
 * 进行中的会话(select_template/fill_fields/rendering)即便旧也不删。
 *
 * 本测试用真实 prisma 插 4 条会话（唯一 chatId 前缀隔离）：
 *   ① state='done'            旧（updated_at 回填 60 天前）→ 应被删
 *   ② state='failed'          旧（updated_at 回填 60 天前）→ 应被删
 *   ③ state='done'            新（updated_at = now）        → 应保留
 *   ④ state='select_template' 旧（updated_at 回填 60 天前）→ 活动态，应保留
 *
 * updatedAt 是 Prisma @updatedAt 托管字段，create 无法直接设；故 create 后
 * 用 $executeRaw 回填底层列 lark_bot_sessions.updated_at。
 * 设 BOT_SESSION_RETENTION_DAYS='30'（方法调用时读 process.env），调
 * cleanupBotSessions()，断言 ①②删、③④在。
 *
 * afterAll 仅按 chatId 前缀 deleteMany 精确清自己造的行，绝不误删真实会话。
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

// 唯一前缀：同一 run 共享时间戳，afterAll 精确定位
const PREFIX = `botcleantest-${Date.now()}`;
const OLD_DATE = new Date(Date.now() - 60 * 86400 * 1000); // 60 天前 → 命中 30 天保留期

describe('bot-session retention cleanup (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  // create + 回填 updated_at 到 60 天前（绕过 @updatedAt 托管字段）
  async function createOld(chatId: string, state: string): Promise<void> {
    const row = await prisma.larkBotSession.create({
      data: { chatId, chatType: 'p2p', triggerOpenId: `${PREFIX}-op`, state },
    });
    await prisma.$executeRaw`UPDATE lark_bot_sessions SET updated_at = ${OLD_DATE} WHERE id = ${row.id}`;
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();

    await createOld(`${PREFIX}-1`, 'done'); // ① 旧 done → 删
    await createOld(`${PREFIX}-2`, 'failed'); // ② 旧 failed → 删
    // ③ 新 done（不回填 → updatedAt = now）→ 保留
    await prisma.larkBotSession.create({
      data: {
        chatId: `${PREFIX}-3`,
        chatType: 'p2p',
        triggerOpenId: `${PREFIX}-op`,
        state: 'done',
      },
    });
    await createOld(`${PREFIX}-4`, 'select_template'); // ④ 旧活动态 → 保留
  });

  afterAll(async () => {
    await prisma.larkBotSession.deleteMany({ where: { chatId: { startsWith: PREFIX } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('deletes old done/failed sessions, keeps recent done and in-progress ones', async () => {
    process.env.BOT_SESSION_RETENTION_DAYS = '30';

    await app.get(RenderCleanupService).cleanupBotSessions();

    const s1 = await prisma.larkBotSession.findFirst({ where: { chatId: `${PREFIX}-1` } });
    const s2 = await prisma.larkBotSession.findFirst({ where: { chatId: `${PREFIX}-2` } });
    const s3 = await prisma.larkBotSession.findFirst({ where: { chatId: `${PREFIX}-3` } });
    const s4 = await prisma.larkBotSession.findFirst({ where: { chatId: `${PREFIX}-4` } });

    expect(s1).toBeNull(); // ① 旧 done 被删
    expect(s2).toBeNull(); // ② 旧 failed 被删
    expect(s3).not.toBeNull(); // ③ 新 done 保留
    expect(s4).not.toBeNull(); // ④ 旧活动态保留
  });
});
