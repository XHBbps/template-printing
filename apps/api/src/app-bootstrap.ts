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
  // 反代拓扑:生产为 nginx 单层反代。设 trust proxy=1 让 express 信任最近一跳的
  // X-Forwarded-For 末项为 req.ip,使限流 IP fallback / 审计 / Sentry 记录真实客户端 IP
  // (而非反代地址);否则 req.ip 恒为反代地址,IP 限流与审计 IP 全部失真。
  const httpAdapter = app.getHttpAdapter().getInstance() as {
    set?: (setting: string, val: unknown) => void;
  };
  httpAdapter.set?.('trust proxy', 1);

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
