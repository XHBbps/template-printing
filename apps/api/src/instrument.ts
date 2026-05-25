/**
 * iter 32 T2：Sentry 初始化 — 必须在所有其他 import 之前完成
 * （Sentry SDK v8 需要在加载 instrumented module 前 init 才能完整 hook）。
 *
 * 该文件需要在 main.ts 顶部 `import './instrument.js'` 第一行触发。
 *
 * SENTRY_DSN 未设置或为空时静默跳过 — 应用正常启动，仅无错误追踪。
 */
// eslint-disable-next-line import/no-unresolved
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;
if (dsn && dsn.startsWith('https://')) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.APP_VERSION ?? 'dev',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // 4xx 鉴权错误（预期内）不上报
    beforeSend(event) {
      const type = event.exception?.values?.[0]?.type ?? '';
      if (
        type === 'UnauthorizedException' ||
        type === 'ForbiddenException' ||
        type === 'BadRequestException' ||
        type === 'NotFoundException'
      ) {
        return null;
      }
      return event;
    },
  });
  // eslint-disable-next-line no-console
  console.log(`[sentry] initialised (env=${process.env.NODE_ENV ?? 'development'})`);
}
