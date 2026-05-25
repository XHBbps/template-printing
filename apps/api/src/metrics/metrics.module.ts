// eslint-disable-next-line import/no-unresolved
import { Global, Module } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { MetricsController } from './metrics.controller.js';
// eslint-disable-next-line import/no-unresolved
import { MetricsService } from './metrics.service.js';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
