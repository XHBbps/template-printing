import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

// eslint-disable-next-line import/no-unresolved
import { PuppeteerPool } from './puppeteer-pool.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const BROWSERS = Number(process.env.RENDER_BROWSERS ?? 4);
const PAGES_PER_BROWSER = Number(process.env.RENDER_PAGES_PER_BROWSER ?? 2);

async function main(): Promise<void> {
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const pool = new PuppeteerPool({ browsers: BROWSERS, pagesPerBrowser: PAGES_PER_BROWSER });
  await pool.warmup();

  // eslint-disable-next-line no-console
  console.log(`[render] pool ready (capacity=${pool.capacity})`);

  // Placeholder queue + worker — real job handling in Plan 4.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const renderQueue = new Queue('render', { connection });
  const worker = new Worker(
    'render',
    async (job) => {
      // eslint-disable-next-line no-console
      console.log(`[render] received job ${job.id} — placeholder, no work performed`);
      return { ok: true, placeholder: true };
    },
    { connection },
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
