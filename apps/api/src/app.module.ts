import { join } from 'path';

// eslint-disable-next-line import/no-unresolved
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { ServeStaticModule } from '@nestjs/serve-static';
// eslint-disable-next-line import/no-unresolved
import { LoggerModule } from 'nestjs-pino';

// eslint-disable-next-line import/no-unresolved
import { AuthModule } from './auth/auth.module.js';
// eslint-disable-next-line import/no-unresolved
import { pinoConfig } from './common/logger.js';
// eslint-disable-next-line import/no-unresolved
import { SecurityHeadersMiddleware } from './common/security-headers.middleware.js';
// eslint-disable-next-line import/no-unresolved
import { HealthModule } from './health/health.module.js';
// eslint-disable-next-line import/no-unresolved
import { LarkImModule } from './lark/lark-im.module.js';
// eslint-disable-next-line import/no-unresolved
import { PrismaModule } from './prisma/prisma.module.js';
// eslint-disable-next-line import/no-unresolved
import { TemplatesModule } from './templates/templates.module.js';
// eslint-disable-next-line import/no-unresolved
import { UploadsModule } from './uploads/uploads.module.js';

@Module({
  imports: [
    LoggerModule.forRoot(pinoConfig(process.env.NODE_ENV ?? 'development')),
    ServeStaticModule.forRoot({
      rootPath: join(process.env.STORAGE_ROOT ?? '/storage'),
      serveRoot: '/',
      exclude: ['/healthz', '/auth/*', '/users/*'],
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    UploadsModule,
    LarkImModule,
    TemplatesModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');
  }
}
