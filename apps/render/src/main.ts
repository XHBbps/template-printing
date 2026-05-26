// eslint-disable-next-line import/no-unresolved
import { UnrecoverableError, Worker } from 'bullmq';
// eslint-disable-next-line import/no-unresolved
import IORedis from 'ioredis';

// eslint-disable-next-line import/no-unresolved
import {
  fetchJob,
  fetchTemplate,
  fetchTemplateVersion,
  markDone,
  markFailed,
  markProcessing,
} from './db.js';
// eslint-disable-next-line import/no-unresolved
import { PuppeteerPool } from './puppeteer-pool.js';
// eslint-disable-next-line import/no-unresolved
import { renderJobOnPage, resolvePaperMm } from './renderer.js';
// eslint-disable-next-line import/no-unresolved
import { sendCallback } from './webhook.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const BROWSERS = Number(process.env.RENDER_BROWSERS ?? 4);
const PAGES_PER_BROWSER = Number(process.env.RENDER_PAGES_PER_BROWSER ?? 2);

async function main(): Promise<void> {
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const pool = new PuppeteerPool({ browsers: BROWSERS, pagesPerBrowser: PAGES_PER_BROWSER });
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
      const tpl =
        job.template_version != null
          ? await fetchTemplateVersion(job.template_id, job.template_version)
          : await fetchTemplate(job.template_id);
      if (!tpl) {
        // template_not_found 永久失败 — 跳过剩余 attempts
        await markFailed(jobId, 'template_not_found', attemptNo);
        await sendCallback(jobId, job.callback_url);
        throw new UnrecoverableError('template_not_found');
      }

      await markProcessing(jobId);
      const page = await pool.acquire();
      try {
        const paperMm = resolvePaperMm(tpl.data);
        const result = await renderJobOnPage(page, {
          jobId,
          template: tpl.data as object,
          data: job.data,
          formats: job.formats,
          paperMm,
        });
        await markDone(jobId, result.pdfUrl, result.pngUrl, attemptNo);
        // eslint-disable-next-line no-console
        console.log(`[render] done ${jobId} (attempt ${attemptNo})`);
      } catch (e) {
        const msg = (e as Error).message ?? 'unknown_error';
        // eslint-disable-next-line no-console
        console.error(`[render] failed ${jobId} (attempt ${attemptNo}/${totalAttempts}): ${msg}`);
        // markFailed 仅在最后一次 attempt 调用 — 中间失败保持 status='processing'，
        // 避免 status 在 retry 期间反复 failed/processing 闪烁
        if (isLastAttempt) {
          await markFailed(jobId, msg, attemptNo);
          await sendCallback(jobId, job.callback_url);
        }
        // 抛错让 bullmq 走 attempts + backoff 重试逻辑
        throw e;
      } finally {
        pool.release(page);
      }

      // 成功也通知 webhook
      await sendCallback(jobId, job.callback_url);
    },
    { connection, concurrency: BROWSERS * PAGES_PER_BROWSER },
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
