// eslint-disable-next-line import/no-unresolved
import pg from 'pg';

const url =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@postgres:5432/template_printing';
export const pool = new pg.Pool({ connectionString: url });

export interface JobRow {
  id: string;
  template_id: string;
  template_version: number | null;
  data: Record<string, unknown>;
  formats: string[];
  status: string;
  pdf_url: string | null;
  png_url: string | null;
  error_msg: string | null;
  callback_url: string | null;
}

export interface TemplateRow {
  id: string;
  name: string;
  data: unknown;
}

export async function fetchJob(id: string): Promise<JobRow | null> {
  const r = await pool.query<JobRow>(
    'SELECT id, template_id, template_version, data, formats, status, pdf_url, png_url, error_msg, callback_url FROM render_jobs WHERE id = $1',
    [id],
  );
  return r.rows[0] ?? null;
}

export async function fetchTemplate(id: string): Promise<TemplateRow | null> {
  const r = await pool.query<TemplateRow>('SELECT id, name, data FROM templates WHERE id = $1', [
    id,
  ]);
  return r.rows[0] ?? null;
}

export async function fetchTemplateVersion(
  templateId: string,
  version: number,
): Promise<TemplateRow | null> {
  const r = await pool.query<TemplateRow>(
    'SELECT t.id, t.name, tv.data FROM template_versions tv JOIN templates t ON t.id = tv.template_id WHERE tv.template_id = $1 AND tv.version = $2',
    [templateId, version],
  );
  return r.rows[0] ?? null;
}

export async function markProcessing(id: string): Promise<void> {
  await pool.query('UPDATE render_jobs SET status = $1, started_at = NOW() WHERE id = $2', [
    'processing',
    id,
  ]);
}

export async function markDone(
  id: string,
  pdfUrl: string | null,
  pngUrl: string | null,
  attemptsMade = 1,
): Promise<void> {
  await pool.query(
    'UPDATE render_jobs SET status = $1, pdf_url = $2, png_url = $3, completed_at = NOW(), attempts_made = $4 WHERE id = $5',
    ['done', pdfUrl, pngUrl, attemptsMade, id],
  );
}

export async function markFailed(id: string, errorMsg: string, attemptsMade = 1): Promise<void> {
  await pool.query(
    'UPDATE render_jobs SET status = $1, error_msg = $2, completed_at = NOW(), attempts_made = $3 WHERE id = $4',
    ['failed', errorMsg, attemptsMade, id],
  );
}

export async function markCallbackStatus(id: string, status: 'sent' | 'failed'): Promise<void> {
  await pool.query('UPDATE render_jobs SET callback_status = $1 WHERE id = $2', [status, id]);
}
