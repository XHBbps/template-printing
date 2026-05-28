/* eslint-disable import/no-unresolved */
// iter 32 T2：Sentry 必须在所有其他 import 之前初始化（SDK v8 要求）
import './instrument.js';

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
/* eslint-enable import/no-unresolved */

// eslint-disable-next-line import/no-unresolved
import { AppModule } from './app.module.js';
// eslint-disable-next-line import/no-unresolved
import { validateEnv, type Env } from './common/env.js';
// eslint-disable-next-line import/no-unresolved
import { GlobalExceptionFilter } from './common/exception.filter.js';

/**
 * 同时供 bootstrap() 和 e2e 测试调用,保证生产与测试走同一份中间件/CORS 配置.
 * 注意:不在内部调用 useLogger(因为 Logger provider 仅 AppModule 注册,e2e 用别的子模块时会拿不到).
 */
export function configureApp(app: INestApplication, env: Env): void {
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );

  const allowed = env.CORS_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin, cb) => {
      // 无 Origin(同源/服务端/curl 等)放行；有 Origin 须在白名单
      if (!origin || allowed.includes(origin)) cb(null, true);
      else cb(null, false);
    },
    credentials: true,
  });
}

async function bootstrap(): Promise<void> {
  const env = validateEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app, env);
  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${env.PORT}`);
}

// 仅当作为入口被 node 直接执行时启动;被 import(如测试)时不启动.
// import.meta.url 在 ESM 中可用,但本仓库 tsconfig 转 CJS,故用 require.main 检测.
// 简单起见:始终启动,但导出 configureApp 仅用于 import 场景(测试不会触发 bootstrap 因为它只 import configureApp,不会 import main 的副作用部分... 实际上 ESM import 会执行整个模块).
// 为避免测试 import 触发 listen,这里做最小防护:NODE_ENV==='test' 时跳过 bootstrap.
if (process.env.NODE_ENV !== 'test') {
  bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Bootstrap failed:', err);
    process.exit(1);
  });
}
