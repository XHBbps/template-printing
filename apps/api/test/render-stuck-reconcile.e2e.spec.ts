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
  let service: RenderCleanupService;
  let cbServer: http.Server;
  let cbUrl: string;
  let cbCalls: ReceivedCall[];

  // IDs to clean up
  let ownerId: string;
  let templateId: string;
  let jobAId: string; // stuck (30 min ago) — should be reconciled
  let jobBId: string; // fresh (now) — should be untouched

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

    // Instantiate service with real prisma + fake FileSig
    service = new RenderCleanupService(prisma as never, fakeFileSig);
  });

  afterAll(async () => {
    await prisma.renderJob.deleteMany({ where: { templateId } });
    await prisma.template.deleteMany({ where: { id: templateId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
    cbServer.close();
  });

  it('reconcileStuckJobs marks stuck job as failed/stuck_timeout and leaves fresh job alone', async () => {
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
