import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, it, expect } from '@jest/globals';

// eslint-disable-next-line import/no-unresolved
import { EnvSchema } from '../src/common/env.js';

const exampleText = readFileSync(join(__dirname, '../../../.env.prod.example'), 'utf8');
const exampleKeys = new Set(
  exampleText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('=')[0]!.trim()),
);

const COMPOSE_INJECTED = new Set(['DATABASE_URL', 'REDIS_URL', 'NODE_ENV']);
const NON_ENVTS_ALLOWED = new Set([
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'TAG',
  'REGISTRY',
  'NODE_ENV',
  'WEB_BASE',
  'STORAGE_ROOT',
  'PUPPETEER_EXECUTABLE_PATH',
  'RENDER_JOB_TIMEOUT_MS',
  'RENDER_ACQUIRE_TIMEOUT_MS',
  'RENDER_LOCK_DURATION_MS',
  'RENDER_PAGE_MAX_USES',
  'RENDER_STUCK_TIMEOUT_MIN',
  'CALLBACK_RESEND_MAX_ATTEMPTS',
  'RENDER_DEVICE_SCALE_FACTOR',
  'RENDER_BACKOFF_BASE_MS',
  'RENDER_CALLBACK_SECRET',
  'UPLOAD_ORPHAN_GRACE_DAYS',
  'AUDIT_LOG_RETENTION_DAYS',
  'BOT_SESSION_RETENTION_DAYS',
  'LARK_ALERT_CHAT_ID', // 运行时告警群 chat_id,服务直接读 process.env(不进 env.ts schema)
]);

const shape = EnvSchema.shape as Record<
  string,
  { safeParse: (v: unknown) => { success: boolean } }
>;
const schemaKeys = Object.keys(shape);
const requiredKeys = Object.entries(shape)
  .filter(([, def]) => !def.safeParse(undefined).success)
  .map(([k]) => k);

describe('.env.prod.example ⟷ env.ts 双向一致', () => {
  it('每个必填 env.ts 字段都被 .env.prod.example 或 compose 注入覆盖', () => {
    const missing = requiredKeys.filter((k) => !exampleKeys.has(k) && !COMPOSE_INJECTED.has(k));
    expect(missing).toEqual([]);
  });
  it('.env.prod.example 无 env.ts/允许清单 都不认识的键(防 JWT_ACCESS_SECRET 式 drift)', () => {
    const known = new Set([...schemaKeys, ...NON_ENVTS_ALLOWED]);
    const unknown = [...exampleKeys].filter((k) => !known.has(k));
    expect(unknown).toEqual([]);
  });
});
