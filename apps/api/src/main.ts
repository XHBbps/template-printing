import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

// eslint-disable-next-line import/no-unresolved
import { AppModule } from './app.module.js';
// eslint-disable-next-line import/no-unresolved
import { validateEnv } from './common/env.js';

async function bootstrap() {
  const env = validateEnv(); // fails fast if misconfigured
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${env.PORT}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
