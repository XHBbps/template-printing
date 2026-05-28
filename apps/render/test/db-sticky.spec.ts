import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// eslint-disable-next-line import/no-unresolved
import { pool, markProcessing, markDone, markFailed } from '../src/db.js';

// 唯一前缀,afterAll 用它清干净造的行,绝不误删真实数据。
const PREFIX = `dbsticky-${Date.now()}`;
const userId = `${PREFIX}-user`;
const templateId = `${PREFIX}-tpl`;
const jobA = `${PREFIX}-jobA`;
const jobB = `${PREFIX}-jobB`;

async function statusOf(id: string): Promise<string | undefined> {
  const r = await pool.query<{ status: string }>('SELECT status FROM render_jobs WHERE id = $1', [
    id,
  ]);
  return r.rows[0]?.status;
}

async function errorMsgOf(id: string): Promise<string | null | undefined> {
  const r = await pool.query<{ error_msg: string | null }>(
    'SELECT error_msg FROM render_jobs WHERE id = $1',
    [id],
  );
  return r.rows[0]?.error_msg;
}

async function makeProcessingJob(id: string): Promise<void> {
  await pool.query(
    `INSERT INTO render_jobs (id, template_id, data, formats, status) VALUES ($1, $2, $3, $4, $5)`,
    [id, templateId, JSON.stringify({}), ['pdf'], 'processing'],
  );
}

beforeAll(async () => {
  // users.id / users.updated_at 必填(NOT NULL 无 DB 默认);role/created_at 有默认。
  await pool.query('INSERT INTO users (id, updated_at) VALUES ($1, NOW())', [userId]);
  // templates.id/name/data/owner_id/updated_at 必填(NOT NULL 无 DB 默认)。
  await pool.query(
    'INSERT INTO templates (id, name, data, owner_id, updated_at) VALUES ($1, $2, $3, $4, NOW())',
    [templateId, `${PREFIX}-name`, JSON.stringify({}), userId],
  );
});

afterAll(async () => {
  // 逆 FK 序清理:render_jobs → templates → users。前缀唯一,只删本测试造的行。
  await pool.query('DELETE FROM render_jobs WHERE id LIKE $1', [`${PREFIX}%`]);
  await pool.query('DELETE FROM templates WHERE id LIKE $1', [`${PREFIX}%`]);
  await pool.query('DELETE FROM users WHERE id LIKE $1', [`${PREFIX}%`]);
  // 照搬 pool.spec.ts 收尾:不 pool.end()(避免影响并行)。
});

describe('db 终态粘性 (markDone/markFailed)', () => {
  it('markDone 命中 processing job → 返回 1 且 status=done', async () => {
    await makeProcessingJob(jobA);
    await markProcessing(jobA);

    const affected = await markDone(jobA, '/uploads/render/x.pdf', null, 1);
    expect(affected).toBe(1);
    expect(await statusOf(jobA)).toBe('done');
  });

  it('对已 done job 调 markFailed → 返回 0,status 仍 done 且 error_msg 未被覆盖', async () => {
    // jobA 在上个用例已 done;再标 failed 不应覆盖终态。
    const affected = await markFailed(jobA, 'boom', 2);
    expect(affected).toBe(0);
    expect(await statusOf(jobA)).toBe('done');
    expect(await errorMsgOf(jobA)).toBeNull();
  });

  it('markFailed 命中 processing → 返回 1=failed;之后 markDone 返回 0,status 仍 failed', async () => {
    await makeProcessingJob(jobB);
    await markProcessing(jobB);

    const failedAffected = await markFailed(jobB, 'e', 1);
    expect(failedAffected).toBe(1);
    expect(await statusOf(jobB)).toBe('failed');

    const doneAffected = await markDone(jobB, '/uploads/render/y.pdf', null, 2);
    expect(doneAffected).toBe(0);
    expect(await statusOf(jobB)).toBe('failed');
  });
});
