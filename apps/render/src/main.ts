// eslint-disable-next-line import/no-unresolved
import { Worker } from 'bullmq';
// eslint-disable-next-line import/no-unresolved
import IORedis from 'ioredis';

// eslint-disable-next-line import/no-unresolved
import { fetchJob, fetchTemplate, markDone, markFailed, markProcessing } from './db.js';
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
      // eslint-disable-next-line no-console
      console.log(`[render] start job ${jobId}`);

      const job = await fetchJob(jobId);
      if (!job) {
        // eslint-disable-next-line no-console
        console.warn(`[render] job ${jobId} not found in db`);
        return;
      }
      const tpl = await fetchTemplate(job.template_id);
      if (!tpl) {
        await markFailed(jobId, 'template_not_found');
        await sendCallback(jobId, job.callback_url);
        return;
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
        await markDone(jobId, result.pdfUrl, result.pngUrl);
        // eslint-disable-next-line no-console
        console.log(`[render] done ${jobId}`);
      } catch (e) {
        const msg = (e as Error).message ?? 'unknown_error';
        // eslint-disable-next-line no-console
        console.error(`[render] failed ${jobId}: ${msg}`);
        await markFailed(jobId, msg);
      } finally {
        pool.release(page);
      }

      // Webhook (success or failure both reported)
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
