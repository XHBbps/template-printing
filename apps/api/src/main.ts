/* eslint-disable import/no-unresolved */
// iter 32 T2：Sentry 必须在所有其他 import 之前初始化（SDK v8 要求）
import './instrument.js';

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
/* eslint-enable import/no-unresolved */

// eslint-disable-next-line import/no-unresolved
import { configureApp } from './app-bootstrap.js';
// eslint-disable-next-line import/no-unresolved
import { AppModule } from './app.module.js';
// eslint-disable-next-line import/no-unresolved
import { validateEnv } from './common/env.js';

async function bootstrap(): Promise<void> {
  const env = validateEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app, env);
  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${env.PORT}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
