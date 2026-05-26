import { join } from 'path';

// eslint-disable-next-line import/no-unresolved
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { APP_GUARD } from '@nestjs/core';
// eslint-disable-next-line import/no-unresolved
import { ScheduleModule } from '@nestjs/schedule';
// eslint-disable-next-line import/no-unresolved
import { ServeStaticModule } from '@nestjs/serve-static';
// eslint-disable-next-line import/no-unresolved
import { ThrottlerModule } from '@nestjs/throttler';
// eslint-disable-next-line import/no-unresolved
import { LoggerModule } from 'nestjs-pino';

// eslint-disable-next-line import/no-unresolved
import { AuditModule } from './audit/audit.module.js';
// eslint-disable-next-line import/no-unresolved
import { AuthModule } from './auth/auth.module.js';
// eslint-disable-next-line import/no-unresolved
import { pinoConfig } from './common/logger.js';
// eslint-disable-next-line import/no-unresolved
import { SecurityHeadersMiddleware } from './common/security-headers.middleware.js';
// eslint-disable-next-line import/no-unresolved
import { UserThrottlerGuard } from './common/user-throttler.guard.js';
// eslint-disable-next-line import/no-unresolved
import { HealthModule } from './health/health.module.js';
// eslint-disable-next-line import/no-unresolved
import { LarkModule } from './lark/lark.module.js';
// eslint-disable-next-line import/no-unresolved
import { MetricsModule } from './metrics/metrics.module.js';
// eslint-disable-next-line import/no-unresolved
import { PrismaModule } from './prisma/prisma.module.js';
// eslint-disable-next-line import/no-unresolved
import { RenderModule } from './render/render.module.js';
// eslint-disable-next-line import/no-unresolved
import { TemplatesModule } from './templates/templates.module.js';
// eslint-disable-next-line import/no-unresolved
import { UploadsModule } from './uploads/uploads.module.js';
// eslint-disable-next-line import/no-unresolved
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    LoggerModule.forRoot(pinoConfig(process.env.NODE_ENV ?? 'development')),
    ServeStaticModule.forRoot({
      rootPath: join(process.env.STORAGE_ROOT ?? '/storage'),
      serveRoot: '/',
      // /uploads/render/* 走 SignedUploadsController（HMAC token 校验），不通过静态服务
      exclude: ['/healthz', '/auth/*', '/users/*', '/uploads/render/*'],
    }),
    // iter 31 T3：全局 rate limit 60 req/min/user。POST /api/render 用
    // @Throttle 在 controller 内 override 为 30/min（可 .env 覆盖）。
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    // iter 31 T5：cron 调度（自动清理 N 天前 render 输出文件）
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule, // iter 32 T1：@Global 全局可用
    MetricsModule, // iter 32 T3：@Global，/metrics 端点
    HealthModule,
    AuthModule,
    UploadsModule,
    LarkModule,
    TemplatesModule,
    RenderModule,
    UsersModule,
  ],
  providers: [
    // iter 31 T3：全局应用 throttler（限流），tracker 用 user.sub 优先 IP fallback
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');
  }
}
