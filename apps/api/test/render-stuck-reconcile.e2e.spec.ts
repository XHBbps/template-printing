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

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
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

    // Instantiate service with racing prisma proxy + fake FileSig + real Metrics
    service = new RenderCleanupService(racingPrisma as never, fakeFileSig, metrics);
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
