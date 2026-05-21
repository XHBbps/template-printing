import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

// eslint-disable-next-line import/no-unresolved
import { pinoConfig } from './common/logger.js';

@Module({
  imports: [LoggerModule.forRoot(pinoConfig(process.env.NODE_ENV ?? 'development'))],
})
export class AppModule {}
