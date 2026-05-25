// eslint-disable-next-line import/no-unresolved
import { fetch } from 'undici';

// eslint-disable-next-line import/no-unresolved
import { fetchJob, markCallbackStatus } from './db.js';
// eslint-disable-next-line import/no-unresolved
import { signUrl } from './file-sig.js';

export async function sendCallback(jobId: string, callbackUrl: string | null): Promise<void> {
  if (!callbackUrl) return;

  // Fetch the final job state to get URLs + status
  const job = await fetchJob(jobId);
  if (!job) return;

  const payload = {
    jobId,
    status: job.status,
    pdfUrl: signUrl(job.pdf_url ?? null),
    pngUrl: signUrl(job.png_url ?? null),
    errorMsg: job.error_msg ?? null,
  };

  try {
    const res = await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // Don't block too long on slow webhook receivers
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      await markCallbackStatus(jobId, 'sent');
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[render] callback ${callbackUrl} returned ${res.status}`);
      await markCallbackStatus(jobId, 'failed');
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[render] callback ${callbackUrl} threw: ${(e as Error).message}`);
    await markCallbackStatus(jobId, 'failed');
  }
}
