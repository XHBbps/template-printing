// eslint-disable-next-line import/no-unresolved
import { UnrecoverableError, Worker } from 'bullmq';
// eslint-disable-next-line import/no-unresolved
import IORedis from 'ioredis';

// eslint-disable-next-line import/no-unresolved
import { jitterBackoff } from './backoff.js';
import {
  fetchJob,
  fetchTemplate,
  fetchTemplateVersion,
  markDone,
  markFailed,
  markProcessing,
  // eslint-disable-next-line import/no-unresolved
} from './db.js';
// eslint-disable-next-line import/no-unresolved
import { PuppeteerPool } from './puppeteer-pool.js';
// eslint-disable-next-line import/no-unresolved
import { renderJobOnPage, resolvePaperMm } from './renderer.js';
// eslint-disable-next-line import/no-unresolved
import { isValidTemplate } from './schema-precheck.js';
// eslint-disable-next-line import/no-unresolved
import { sendCallback } from './webhook.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const BROWSERS = Number(process.env.RENDER_BROWSERS ?? 4);
const PAGES_PER_BROWSER = Number(process.env.RENDER_PAGES_PER_BROWSER ?? 2);
const JOB_TIMEOUT_MS = Number(process.env.RENDER_JOB_TIMEOUT_MS ?? 60_000);
const ACQUIRE_TIMEOUT_MS = Number(process.env.RENDER_ACQUIRE_TIMEOUT_MS ?? 30_000);
const PAGE_MAX_USES = Number(process.env.RENDER_PAGE_MAX_USES ?? 200);
// lock 必须 ≥ 等页 + 渲染 + 余量（bullmq lock 覆盖整个 processor 执行）
const LOCK_DURATION_MS = Number(
  process.env.RENDER_LOCK_DURATION_MS ?? ACQUIRE_TIMEOUT_MS + JOB_TIMEOUT_MS + 30_000,
);

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

async function main(): Promise<void> {
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const pool = new PuppeteerPool({
    browsers: BROWSERS,
    pagesPerBrowser: PAGES_PER_BROWSER,
    maxPageUses: PAGE_MAX_USES,
    acquireTimeoutMs: ACQUIRE_TIMEOUT_MS,
  });
  await pool.warmup();
  // eslint-disable-next-line no-console
  console.log(`[render] pool ready (capacity=${pool.capacity})`);

  const worker = new Worker(
    'render',
    async (bullJob) => {
      const jobId = (bullJob.data as { jobId: string }).jobId;
      // bullmq 1-indexed: 第 N 次尝试时 attemptsMade = N
      const attemptNo = (bullJob.attemptsMade ?? 0) + 1;
      const totalAttempts = bullJob.opts.attempts ?? 1;
      const isLastAttempt = attemptNo >= totalAttempts;
      // eslint-disable-next-line no-console
      console.log(`[render] start job ${jobId} (attempt ${attemptNo}/${totalAttempts})`);

      const job = await fetchJob(jobId);
      if (!job) {
        // 业务行不存在 — 视作 permanent 失败（永远等不到）
        // eslint-disable-next-line no-console
        console.warn(`[render] job ${jobId} not found in db — permanent failure`);
        throw new UnrecoverableError(`job ${jobId} not found in db`);
      }
      // P0：已终态 → stalled 重投/重复派发，直接跳过，杜绝重复渲染+重复回调
      if (job.status === 'done' || job.status === 'failed') {
        // eslint-disable-next-line no-console
        console.log(`[render] job ${jobId} already ${job.status} — skip (stalled re-exec)`);
        return;
      }
      const tpl =
        job.template_version != null
          ? await fetchTemplateVersion(job.template_id, job.template_version)
          : await fetchTemplate(job.template_id);
      if (!tpl) {
        // template_not_found 永久失败 — 跳过剩余 attempts
        const changed = await markFailed(jobId, 'template_not_found', attemptNo);
        if (changed > 0) await sendCallback(jobId, job.callback_url);
        throw new UnrecoverableError('template_not_found');
      }

      const check = isValidTemplate(tpl.data);
      if (!check.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[render] job ${jobId} template schema_invalid: ${check.reason}`);
        const changed = await markFailed(jobId, 'schema_invalid', attemptNo);
        if (changed > 0) await sendCallback(jobId, job.callback_url);
        throw new UnrecoverableError('schema_invalid');
      }

      await markProcessing(jobId);
      const page = await pool.acquire();
      let ok = false;
      let doneChanged = 0;
      try {
        const paperMm = resolvePaperMm(tpl.data);
        const renderPromise = renderJobOnPage(page, {
          jobId,
          template: tpl.data as object,
          data: job.data,
          formats: job.formats,
          paperMm,
        });
        // 超时后 race reject；loser(renderPromise) 随后因关页 reject → 吞掉防 unhandledRejection
        renderPromise.catch(() => {});
        const result = await withTimeout(renderPromise, JOB_TIMEOUT_MS, 'render');
        doneChanged = await markDone(jobId, result.pdfUrl, result.pngUrl, attemptNo);
        ok = true;
        // eslint-disable-next-line no-console
        console.log(`[render] done ${jobId} (attempt ${attemptNo})`);
      } catch (e) {
        const msg = (e as Error).message ?? 'unknown_error';
        // eslint-disable-next-line no-console
        console.error(`[render] failed ${jobId} (attempt ${attemptNo}/${totalAttempts}): ${msg}`);
        if (isLastAttempt) {
          const failChanged = await markFailed(jobId, msg, attemptNo);
          if (failChanged > 0) await sendCallback(jobId, job.callback_url);
        }
        throw e;
      } finally {
        if (ok) pool.release(page);
        // 出错/超时的页大概率污染 → 回收;recycle 自身再设 15s 超时兜底,
        // 防 page.close/launch 卡死把 worker 槽永久拖住(总预算仍 < lockDuration)。
        else await withTimeout(pool.recycle(page), 15_000, 'recycle').catch(() => {});
      }

      // 成功才到这（失败已 throw）：仅当本次真翻转 done 才回调（防与 cron 抢先标 failed 后重复成功回调）
      if (doneChanged > 0) await sendCallback(jobId, job.callback_url);
    },
    {
      connection,
      concurrency: BROWSERS * PAGES_PER_BROWSER,
      lockDuration: LOCK_DURATION_MS,
      stalledInterval: 30_000,
      maxStalledCount: 1,
      settings: { backoffStrategy: (attemptsMade: number) => jitterBackoff(attemptsMade) },
    },
  );

  const shutdown = async (): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log('[render] shutting down…');
    await worker.close();
    await pool.shutdown();
    await connection.quit();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[render] fatal:', err);
  process.exit(1);
});
