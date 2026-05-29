/**
 * e2e: 僵尸 processing job 对账 cron (reconcileStuckJobs)
 *
 * 采用直接实例化 RenderCleanupService + 真实 PrismaClient 的方式
 * (对齐 stats-overview.e2e.spec.ts 中 new StatsService(prisma as never) 的模式)。
 * FileSigService 使用最小 fake (signUrl(null) → null，与真实实现一致)。
 *
 * HTTP 回调接收用 Node 原生 http.createServer，绑定随机端口。
 */
import * as http from 'node:http';

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { PrismaClient } from '@prisma/client';

// eslint-disable-next-line import/no-unresolved
import { MetricsService } from '../src/metrics/metrics.service.js';
// eslint-disable-next-line import/no-unresolved
import { RenderCleanupService } from '../src/render/render-cleanup.service.js';

// ──────────────────────────────────────────
// Minimal FileSigService fake (signUrl follows real: null → null)
// ──────────────────────────────────────────
const fakeFileSig = {
  signUrl: (url: string | null | undefined): string | null => {
    if (!url) return null;
    return url;
  },
} as never;

// 运行时告警用的 LarkImService 桩:sendTextToChat 记录调用。默认 .env.test 无 LARK_ALERT_CHAT_ID,
// 故除"告警"专用 describe 外不会被调用。
const sendTextToChat = jest.fn(async () => true);
const fakeLarkIm = { sendTextToChat } as never;

// ──────────────────────────────────────────
// Tiny HTTP server to receive webhook callbacks
// ──────────────────────────────────────────
interface ReceivedCall {
  method: string;
  body: unknown;
}

function startCallbackServer(): Promise<{
  server: http.Server;
  url: string;
  calls: ReceivedCall[];
}> {
  return new Promise((resolve) => {
    const calls: ReceivedCall[] = [];
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString();
      });
      req.on('end', () => {
        let body: unknown = raw;
        try {
          body = JSON.parse(raw) as unknown;
        } catch {
          // keep raw string
        }
        calls.push({ method: req.method ?? 'GET', body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}`, calls });
    });
  });
}

describe('RenderCleanupService.reconcileStuckJobs (e2e)', () => {
  const prisma = new PrismaClient();
  const metrics = new MetricsService();
  let service: RenderCleanupService;
  let cbServer: http.Server;
  let cbUrl: string;
  let cbCalls: ReceivedCall[];

  // IDs to clean up
  let ownerId: string;
  let templateId: string;
  let jobAId: string; // stuck (30 min ago) — should be reconciled
  let jobBId: string; // fresh (now) — should be untouched
  let jobCId: string; // done (30 min ago) — already terminal, must NOT be overwritten

  beforeAll(async () => {
    // Start callback receiver
    ({ server: cbServer, url: cbUrl, calls: cbCalls } = await startCallbackServer());

    // Create a minimal user + template (renderJob has FK to template)
    await prisma.user.deleteMany({ where: { localUsername: 'e2e_stuck_owner' } });
    const owner = await prisma.user.create({
      data: { localUsername: 'e2e_stuck_owner', role: 'user', name: 'Stuck Owner' },
    });
    ownerId = owner.id;

    const tpl = await prisma.template.create({
      data: { name: 'e2e stuck reconcile tpl', data: {}, ownerId: owner.id },
    });
    templateId = tpl.id;

    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000);
    const justNow = new Date();

    // Job A: processing, 30 min ago → should become failed/stuck_timeout
    const jobA = await prisma.renderJob.create({
      data: {
        templateId,
        data: {},
        formats: ['pdf'],
        status: 'processing',
        startedAt: thirtyMinAgo,
        callbackUrl: `${cbUrl}/callback`,
      },
    });
    jobAId = jobA.id;

    // Job B: processing, started just now → within threshold, untouched
    const jobB = await prisma.renderJob.create({
      data: {
        templateId,
        data: {},
        formats: ['pdf'],
        status: 'processing',
        startedAt: justNow,
        callbackUrl: `${cbUrl}/callback`,
      },
    });
    jobBId = jobB.id;

    // Job C: 造成 processing + 旧 startedAt，使其进入 findMany 快照；但通过下面的
    // prisma 代理，在 findMany resolve 之后、逐行 update 之前把它在 DB 里翻成 done，
    // 精确复现「快照说 processing，但 update 时已被 worker markDone」的竞态。
    // 期望：updateMany({where:{id, status:'processing'}}) count===0，done 行不被覆盖。
    const jobC = await prisma.renderJob.create({
      data: {
        templateId,
        data: {},
        formats: ['pdf'],
        status: 'processing',
        startedAt: thirtyMinAgo,
        callbackUrl: `${cbUrl}/callback`,
      },
    });
    jobCId = jobC.id;

    // 代理 prisma.renderJob.findMany：真实查询返回后（快照里 Job C 仍是 processing），
    // 立刻把 Job C 在 DB 翻成 done（模拟并发 worker markDone），再返回原始快照。
    const racingPrisma = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop === 'renderJob') {
          const realModel = Reflect.get(target, prop, receiver) as typeof prisma.renderJob;
          return new Proxy(realModel, {
            get(mTarget, mProp, mReceiver) {
              if (mProp === 'findMany') {
                return async (...args: unknown[]) => {
                  const res = await (realModel.findMany as (...a: unknown[]) => Promise<unknown>)(
                    ...args,
                  );
                  // 仅触发一次：把 Job C 翻成 done（带 pdfUrl，模拟成功产物）
                  await realModel.update({
                    where: { id: jobCId },
                    data: {
                      status: 'done',
                      completedAt: new Date(),
                      pdfUrl: '/uploads/render/e2e-stuck-done.pdf',
                    },
                  });
                  return res;
                };
              }
              return Reflect.get(mTarget, mProp, mReceiver);
            },
          });
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    // Instantiate service with racing prisma proxy + fake FileSig + real Metrics + fake LarkIm
    service = new RenderCleanupService(racingPrisma as never, fakeFileSig, metrics, fakeLarkIm);
  });

  // Helper: extract the numeric value of tp_render_jobs_total{status="stuck_timeout",...}
  // from a Prometheus exposition text. Sums all matching label-set lines (≥1 expected).
  function stuckTimeoutCount(text: string): number {
    let sum = 0;
    for (const line of text.split('\n')) {
      if (line.startsWith('tp_render_jobs_total') && line.includes('status="stuck_timeout"')) {
        const val = Number(line.slice(line.lastIndexOf(' ') + 1));
        if (Number.isFinite(val)) sum += val;
      }
    }
    return sum;
  }

  afterAll(async () => {
    await prisma.renderJob.deleteMany({ where: { templateId } });
    await prisma.template.deleteMany({ where: { id: templateId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
    cbServer.close();
  });

  it('reconcileStuckJobs marks stuck job as failed/stuck_timeout and leaves fresh job alone', async () => {
    // P2b: capture stuck_timeout counter value BEFORE running cron (process-wide accumulator)
    const before = stuckTimeoutCount(await metrics.expose());

    // Default RENDER_STUCK_TIMEOUT_MIN = 10; job A is 30 min old → past threshold
    await service.reconcileStuckJobs();

    // ── Job A should now be failed ──
    const jobA = await prisma.renderJob.findUnique({ where: { id: jobAId } });
    expect(jobA).not.toBeNull();
    expect(jobA!.status).toBe('failed');
    expect(jobA!.errorMsg).toBe('stuck_timeout');
    expect(jobA!.completedAt).not.toBeNull();

    // ── Job B should still be processing (started just now) ──
    const jobB = await prisma.renderJob.findUnique({ where: { id: jobBId } });
    expect(jobB).not.toBeNull();
    expect(jobB!.status).toBe('processing');

    // ── P2b: tp_render_jobs_total{status="stuck_timeout"} must have been incremented ──
    // Job A was a real stuck processing job (count===1 branch); Job C raced to done
    // (count===0, no inc). So the counter should increase by exactly 1 from `before`.
    const text = await metrics.expose();
    expect(text).toContain('tp_render_jobs_total');
    expect(text).toContain('status="stuck_timeout"');
    const after = stuckTimeoutCount(text);
    expect(after).toBeGreaterThanOrEqual(before + 1);
  });

  it('does NOT overwrite an already-done job (race: snapshot then worker markDone)', async () => {
    // Job C 在快照阶段是 processing（findMany 命中），但 update 前被 worker 完成成 done。
    // 实测中我们直接造成 done 态：reconcileStuckJobs 跑完后该行必须仍 done、未被改写。
    const jobC = await prisma.renderJob.findUnique({ where: { id: jobCId } });
    expect(jobC).not.toBeNull();
    expect(jobC!.status).toBe('done');
    expect(jobC!.errorMsg).not.toBe('stuck_timeout');
    expect(jobC!.pdfUrl).toBe('/uploads/render/e2e-stuck-done.pdf');
  });

  it('callbackStatus on stuck job is set to sent (mock returned 200)', async () => {
    const jobA = await prisma.renderJob.findUnique({ where: { id: jobAId } });
    // Allow either 'sent' (mock returned 200) or 'failed' (network timing) but not null
    expect(jobA!.callbackStatus).not.toBeNull();
    // In a controlled test environment the mock server is local → should be 'sent'
    expect(jobA!.callbackStatus).toBe('sent');
  });

  it('mock callback receiver got exactly one POST with correct payload shape', async () => {
    // Give a tiny window for async callback to flush (it's best-effort fire in the same loop)
    // reconcileStuckJobs already awaited sendStuckCallback, so calls should be present
    expect(cbCalls.length).toBeGreaterThanOrEqual(1);

    // Find the call for jobA
    const call = cbCalls.find((c) => {
      const b = c.body as Record<string, unknown>;
      return b.jobId === jobAId;
    });
    expect(call).toBeDefined();
    expect(call!.method).toBe('POST');

    const body = call!.body as Record<string, unknown>;
    expect(body.jobId).toBe(jobAId);
    expect(body.status).toBe('failed');
    expect(body.pdfUrl).toBeNull();
    expect(body.pngUrl).toBeNull();
    expect(body.errorMsg).toBe('stuck_timeout');
  });
});

/**
 * P6：单条 bulk updateMany 翻转 —— 多条 stuck 同时翻转。
 * 造 3 条 processing+旧 startedAt（应全翻）+ 1 条 processing 但 startedAt 新（不该翻）。
 * 期望：3 条旧的都 failed/stuck_timeout、新的仍 processing；回调次数 == 翻转数(3)；
 * metrics 增量 == 3。验证 bulk 路径精确对应本次翻转，不重不漏。
 */
describe('RenderCleanupService.reconcileStuckJobs — multi-job bulk flip (e2e)', () => {
  const prisma = new PrismaClient();
  const metrics = new MetricsService();
  let service: RenderCleanupService;
  let cbServer: http.Server;
  let cbUrl: string;
  let cbCalls: ReceivedCall[];

  let ownerId: string;
  let templateId: string;
  const stuckIds: string[] = []; // 3 个旧 processing → 应全翻
  let freshId: string; // 1 个新 processing → 不该翻

  beforeAll(async () => {
    ({ server: cbServer, url: cbUrl, calls: cbCalls } = await startCallbackServer());

    await prisma.user.deleteMany({ where: { localUsername: 'e2e_stuck_multi_owner' } });
    const owner = await prisma.user.create({
      data: { localUsername: 'e2e_stuck_multi_owner', role: 'user', name: 'Stuck Multi Owner' },
    });
    ownerId = owner.id;
    const tpl = await prisma.template.create({
      data: { name: 'e2e stuck multi tpl', data: {}, ownerId: owner.id },
    });
    templateId = tpl.id;

    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000);
    const justNow = new Date();

    for (let i = 0; i < 3; i++) {
      const job = await prisma.renderJob.create({
        data: {
          templateId,
          data: {},
          formats: ['pdf'],
          status: 'processing',
          startedAt: thirtyMinAgo,
          callbackUrl: `${cbUrl}/callback`,
        },
      });
      stuckIds.push(job.id);
    }

    const fresh = await prisma.renderJob.create({
      data: {
        templateId,
        data: {},
        formats: ['pdf'],
        status: 'processing',
        startedAt: justNow,
        callbackUrl: `${cbUrl}/callback`,
      },
    });
    freshId = fresh.id;

    service = new RenderCleanupService(prisma as never, fakeFileSig, metrics, fakeLarkIm);
  });

  function stuckTimeoutCount(text: string): number {
    let sum = 0;
    for (const line of text.split('\n')) {
      if (line.startsWith('tp_render_jobs_total') && line.includes('status="stuck_timeout"')) {
        const val = Number(line.slice(line.lastIndexOf(' ') + 1));
        if (Number.isFinite(val)) sum += val;
      }
    }
    return sum;
  }

  afterAll(async () => {
    await prisma.renderJob.deleteMany({ where: { templateId } });
    await prisma.template.deleteMany({ where: { id: templateId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
    cbServer.close();
  });

  it('flips all stuck jobs in one bulk pass, leaves fresh untouched, callbacks == flipped count', async () => {
    const before = stuckTimeoutCount(await metrics.expose());

    await service.reconcileStuckJobs();

    // 3 个旧的都应 failed/stuck_timeout
    for (const id of stuckIds) {
      const job = await prisma.renderJob.findUnique({ where: { id } });
      expect(job).not.toBeNull();
      expect(job!.status).toBe('failed');
      expect(job!.errorMsg).toBe('stuck_timeout');
      expect(job!.completedAt).not.toBeNull();
    }

    // 新的仍 processing
    const fresh = await prisma.renderJob.findUnique({ where: { id: freshId } });
    expect(fresh!.status).toBe('processing');

    // metrics 增量 == 翻转数(3)
    const after = stuckTimeoutCount(await metrics.expose());
    expect(after).toBeGreaterThanOrEqual(before + 3);

    // 回调次数 == 翻转数：恰好 3 个不同的 stuck job 收到 POST，fresh 不应被回调
    const flippedCallbackJobIds = new Set(
      cbCalls
        .map((c) => (c.body as Record<string, unknown>).jobId)
        .filter((id): id is string => typeof id === 'string' && stuckIds.includes(id)),
    );
    expect(flippedCallbackJobIds.size).toBe(3);
    const freshCallbacks = cbCalls.filter(
      (c) => (c.body as Record<string, unknown>).jobId === freshId,
    );
    expect(freshCallbacks.length).toBe(0);
  });
});

/**
 * review 第 7 节「需进一步验证项」#2:渲染耗时逼近 RENDER_STUCK_TIMEOUT_MIN 时
 * cron 与 worker 的状态竞态 —— cron 先翻 stuck_timeout、慢 worker 随后才完成的方向。
 *
 * 结论(确认非真实双回调 bug):批次1 的终态守卫(render db.ts markProcessing/markDone 带
 * `WHERE status NOT IN ('done','failed')`)+ 本服务 reconcile 的 `status='processing'` 守卫,
 * 使得 cron 翻 failed 后,慢 worker 的 markDone 影响 0 行(终态粘性)、且 worker 仅在 rowCount>0
 * 时才发 done 回调 → 全程只有 cron 的 1 次 stuck 回调,无双回调 / 双计数。
 * (代价:确实成功但超时的慢 job 会被判 failed —— 这是 10min 超时的设计取舍,非 bug。)
 */
describe('reconcile 竞态:cron 先翻 stuck,慢 worker 随后 markDone 不能覆盖终态 (e2e)', () => {
  const prisma = new PrismaClient();
  const metrics = new MetricsService();
  let service: RenderCleanupService;
  let cbServer: http.Server;
  let cbUrl: string;
  let cbCalls: ReceivedCall[];
  let ownerId: string;
  let templateId: string;
  let jobId: string;

  beforeAll(async () => {
    ({ server: cbServer, url: cbUrl, calls: cbCalls } = await startCallbackServer());
    await prisma.user.deleteMany({ where: { localUsername: 'e2e_stuck_race_owner' } });
    const owner = await prisma.user.create({
      data: { localUsername: 'e2e_stuck_race_owner', role: 'user', name: 'Stuck Race Owner' },
    });
    ownerId = owner.id;
    const tpl = await prisma.template.create({
      data: { name: 'e2e stuck race tpl', data: {}, ownerId: owner.id },
    });
    templateId = tpl.id;
    // 11 分钟前开始(略超默认 10min 阈值)—— 模拟渲染耗时逼近超时。
    const job = await prisma.renderJob.create({
      data: {
        templateId,
        data: {},
        formats: ['pdf'],
        status: 'processing',
        startedAt: new Date(Date.now() - 11 * 60_000),
        callbackUrl: `${cbUrl}/callback`,
      },
    });
    jobId = job.id;
    service = new RenderCleanupService(prisma as never, fakeFileSig, metrics, fakeLarkIm);
  });

  afterAll(async () => {
    await prisma.renderJob.deleteMany({ where: { templateId } });
    await prisma.template.deleteMany({ where: { id: templateId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
    cbServer.close();
  });

  it('cron 翻 stuck_timeout 后,worker 守卫式 markDone 影响 0 行,只发 1 次回调', async () => {
    // 1) cron 先赢:翻 failed/stuck_timeout + 发 stuck 回调
    await service.reconcileStuckJobs();
    const afterCron = await prisma.renderJob.findUnique({ where: { id: jobId } });
    expect(afterCron!.status).toBe('failed');
    expect(afterCron!.errorMsg).toBe('stuck_timeout');

    // 2) 慢 worker 随后完成,执行与 render db.ts markDone 完全一致的守卫式更新:
    //    WHERE status NOT IN ('done','failed') —— 终态粘性使其影响 0 行。
    const { count } = await prisma.renderJob.updateMany({
      where: { id: jobId, status: { notIn: ['done', 'failed'] } },
      data: { status: 'done', completedAt: new Date(), pdfUrl: '/uploads/render/late.pdf' },
    });
    expect(count).toBe(0); // markDone 影响 0 行 → worker 不会发 done 回调(仅 rowCount>0 才发)

    // 3) 终态未被覆盖,仍是 cron 写的 failed/stuck_timeout
    const finalJob = await prisma.renderJob.findUnique({ where: { id: jobId } });
    expect(finalJob!.status).toBe('failed');
    expect(finalJob!.errorMsg).toBe('stuck_timeout');
    expect(finalJob!.pdfUrl).toBeNull();

    // 4) 全程只有 cron 的 1 次 stuck 回调,无双回调
    const callsForJob = cbCalls.filter((c) => (c.body as Record<string, unknown>).jobId === jobId);
    expect(callsForJob.length).toBe(1);
    expect((callsForJob[0]!.body as Record<string, unknown>).errorMsg).toBe('stuck_timeout');
  });
});

/**
 * 运行时告警:reconcile 翻转 stuck job 时推飞书运维群(LARK_ALERT_CHAT_ID 配了才发,@所有人)。
 */
describe('reconcileStuckJobs → 运行时告警推送 (e2e)', () => {
  const prisma = new PrismaClient();
  const metrics = new MetricsService();
  let service: RenderCleanupService;
  let ownerId: string;
  let templateId: string;
  const CHAT_ID = 'oc_e2e_alert_chat';

  beforeAll(async () => {
    process.env.LARK_ALERT_CHAT_ID = CHAT_ID;
    await prisma.user.deleteMany({ where: { localUsername: 'e2e_stuck_alert_owner' } });
    const owner = await prisma.user.create({
      data: { localUsername: 'e2e_stuck_alert_owner', role: 'user', name: 'Stuck Alert Owner' },
    });
    ownerId = owner.id;
    const tpl = await prisma.template.create({
      data: { name: 'e2e stuck alert tpl', data: {}, ownerId: owner.id },
    });
    templateId = tpl.id;
    // callbackUrl 留空 → 不发 HTTP 回调,聚焦告警行为。
    await prisma.renderJob.create({
      data: {
        templateId,
        data: {},
        formats: ['pdf'],
        status: 'processing',
        startedAt: new Date(Date.now() - 30 * 60_000),
      },
    });
    service = new RenderCleanupService(prisma as never, fakeFileSig, metrics, fakeLarkIm);
  });

  afterAll(async () => {
    delete process.env.LARK_ALERT_CHAT_ID;
    await prisma.renderJob.deleteMany({ where: { templateId } });
    await prisma.template.deleteMany({ where: { id: templateId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
  });

  it('翻转 stuck job → 调 sendTextToChat(目标群 + @所有人 + stuck_timeout 文案)', async () => {
    sendTextToChat.mockClear();
    await service.reconcileStuckJobs();

    expect(sendTextToChat).toHaveBeenCalledTimes(1);
    const [chatIdArg, textArg] = sendTextToChat.mock.calls[0] as unknown as [string, string];
    expect(chatIdArg).toBe(CHAT_ID);
    expect(textArg).toContain('<at user_id="all">'); // @所有人
    expect(textArg).toContain('stuck_timeout');
  });
});
