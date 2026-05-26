// eslint-disable-next-line import/no-unresolved
import { Module } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { StatsController } from './stats.controller.js';
// eslint-disable-next-line import/no-unresolved
import { StatsService } from './stats.service.js';

@Module({
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
