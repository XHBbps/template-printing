import { Module } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
