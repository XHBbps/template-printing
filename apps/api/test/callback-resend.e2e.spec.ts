/**
 * e2e: 回调失败补发 cron (resendFailedCallbacks) — 批次4 P1b
 *
 * 采用直接实例化 RenderCleanupService + 真实 PrismaClient 的方式
 * (对齐 render-stuck-reconcile.e2e.spec.ts)。
 * FileSigService 使用最小 fake (signUrl(null) → null，与真实实现一致)。
 *
 * ⚠️ 精度:飞书内部回调 handler 即使写失败也返回 HTTP 200 → P1b 只服务"外部
 * callbackUrl 端点返 5xx/超时"的调用方。故测试用 Node 原生 http 起一个外部 mock
 * 端点(随机端口),绝不打飞书 handler。
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
// External mock callback endpoint (随机端口, 记录收到的 POST)
// ──────────────────────────────────────────
interface ReceivedCall {
  method: string;
  body: unknown;
}

function startCallbackServer(): Promise<{
  server: http.Server;
  port: number;
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
      resolve({ server, port: addr.port, calls });
    });
  });
}

const PREFIX = 'e2e_cbresend';

describe('RenderCleanupService.resendFailedCallbacks (e2e)', () => {
  const prisma = new PrismaClient();
  let service: RenderCleanupService;
  let cbServer: http.Server;
  let cbPort: number;
  let cbCalls: ReceivedCall[];

  // IDs to clean up
  let ownerId: string;
  let templateId: string;
  let jobEligibleId: string; // failed + 过退避档 → 应补发, mock 200 → sent, attempts=1
  let jobFreshId: string; // completedAt=now, 未过退避档 → 不发
  let jobMaxedId: string; // callbackAttempts>=5 → 不发
  let jobNoUrlId: string; // callbackUrl=null → 不发
  let jobSentId: string; // callbackStatus='sent' → 不发

  beforeAll(async () => {
    process.env.CALLBACK_RESEND_MAX_ATTEMPTS = '5';

    ({ server: cbServer, port: cbPort, calls: cbCalls } = await startCallbackServer());

    // Create a minimal user + template (renderJob has FK to template)
    await prisma.user.deleteMany({ where: { localUsername: `${PREFIX}_owner` } });
    const owner = await prisma.user.create({
      data: { localUsername: `${PREFIX}_owner`, role: 'user', name: 'Resend Owner' },
    });
    ownerId = owner.id;

    const tpl = await prisma.template.create({
      data: { name: `${PREFIX} tpl`, data: {}, ownerId: owner.id },
    });
    templateId = tpl.id;

    const cbUrl = `http://127.0.0.1:${cbPort}/cb`;
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    const now = new Date();

    // Eligible: done, failed callback, attempts=0, completedAt 10 min ago (过 5*2^0=5min 档)
    const jobE = await prisma.renderJob.create({
      data: {
        templateId,
        data: {},
        formats: ['pdf'],
        status: 'done',
        pdfUrl: `/uploads/render/${PREFIX}-eligible.pdf`,
        callbackStatus: 'failed',
        callbackAttempts: 0,
        callbackUrl: cbUrl,
        completedAt: tenMinAgo,
      },
    });
    jobEligibleId = jobE.id;

    // Fresh: completedAt=now → 未过 5min 退避档 → 不发
    const jobF = await prisma.renderJob.create({
      data: {
        templateId,
        data: {},
        formats: ['pdf'],
        status: 'done',
        pdfUrl: `/uploads/render/${PREFIX}-fresh.pdf`,
        callbackStatus: 'failed',
        callbackAttempts: 0,
        callbackUrl: cbUrl,
        completedAt: now,
      },
    });
    jobFreshId = jobF.id;

    // Maxed: attempts>=5 → 不发(即使过退避档)
    const jobM = await prisma.renderJob.create({
      data: {
        templateId,
        data: {},
        formats: ['pdf'],
        status: 'done',
        pdfUrl: `/uploads/render/${PREFIX}-maxed.pdf`,
        callbackStatus: 'failed',
        callbackAttempts: 5,
        callbackUrl: cbUrl,
        completedAt: tenMinAgo,
      },
    });
    jobMaxedId = jobM.id;

    // NoUrl: callbackUrl=null → 不发
    const jobN = await prisma.renderJob.create({
      data: {
        templateId,
        data: {},
        formats: ['pdf'],
        status: 'done',
        pdfUrl: `/uploads/render/${PREFIX}-nourl.pdf`,
        callbackStatus: 'failed',
        callbackAttempts: 0,
        callbackUrl: null,
        completedAt: tenMinAgo,
      },
    });
    jobNoUrlId = jobN.id;

    // Sent: callbackStatus='sent' → 不发
    const jobS = await prisma.renderJob.create({
      data: {
        templateId,
        data: {},
        formats: ['pdf'],
        status: 'done',
        pdfUrl: `/uploads/render/${PREFIX}-sent.pdf`,
        callbackStatus: 'sent',
        callbackAttempts: 0,
        callbackUrl: cbUrl,
        completedAt: tenMinAgo,
      },
    });
    jobSentId = jobS.id;

    service = new RenderCleanupService(prisma as never, fakeFileSig);

    // Run once; then give the mock server a tiny window to flush POST bodies.
    await service.resendFailedCallbacks();
    await new Promise((r) => setTimeout(r, 100));
  });

  afterAll(async () => {
    await prisma.renderJob.deleteMany({ where: { templateId } });
    await prisma.template.deleteMany({ where: { id: templateId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
    cbServer.close();
  });

  it('external mock endpoint received exactly one POST (only eligible job)', () => {
    expect(cbCalls.length).toBe(1);
    const call = cbCalls[0]!;
    expect(call.method).toBe('POST');
    const body = call.body as Record<string, unknown>;
    expect(body.jobId).toBe(jobEligibleId);
    expect(body.status).toBe('done');
    expect(body.errorMsg).toBeNull();
  });

  it('eligible job → callbackStatus sent + callbackAttempts incremented to 1', async () => {
    const job = await prisma.renderJob.findUnique({ where: { id: jobEligibleId } });
    expect(job).not.toBeNull();
    expect(job!.callbackStatus).toBe('sent');
    expect(job!.callbackAttempts).toBe(1);
  });

  it('fresh job (completedAt=now, within backoff) → NOT resent', async () => {
    const job = await prisma.renderJob.findUnique({ where: { id: jobFreshId } });
    expect(job!.callbackStatus).toBe('failed');
    expect(job!.callbackAttempts).toBe(0);
  });

  it('maxed job (callbackAttempts>=5) → NOT resent', async () => {
    const job = await prisma.renderJob.findUnique({ where: { id: jobMaxedId } });
    expect(job!.callbackStatus).toBe('failed');
    expect(job!.callbackAttempts).toBe(5);
  });

  it('job with null callbackUrl → NOT resent', async () => {
    const job = await prisma.renderJob.findUnique({ where: { id: jobNoUrlId } });
    expect(job!.callbackStatus).toBe('failed');
    expect(job!.callbackAttempts).toBe(0);
  });

  it('job with callbackStatus=sent → NOT resent', async () => {
    const job = await prisma.renderJob.findUnique({ where: { id: jobSentId } });
    expect(job!.callbackStatus).toBe('sent');
    expect(job!.callbackAttempts).toBe(0);
  });
});
