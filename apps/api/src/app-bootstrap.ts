/* eslint-disable import/no-unresolved */
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
/* eslint-enable import/no-unresolved */

// eslint-disable-next-line import/no-unresolved
import { type Env } from './common/env.js';
// eslint-disable-next-line import/no-unresolved
import { GlobalExceptionFilter } from './common/exception.filter.js';

/**
 * 同时供 bootstrap() 和 e2e 测试调用,保证生产与测试走同一份中间件/CORS 配置.
 * 注意:不在内部调用 useLogger(因为 Logger provider 仅 AppModule 注册,e2e 用别的子模块时会拿不到).
 *
 * 本模块为纯导出、无顶层副作用:测试 import 它不会触发 bootstrap()/app.listen(),
 * 避免「import a file after the Jest environment has been torn down」等泄漏.
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
