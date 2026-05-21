import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
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
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    LoggerModule.forRoot(pinoConfig(process.env.NODE_ENV ?? 'development')),
    PrismaModule,
    HealthModule,
    AuthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');
  }
}
