// eslint-disable-next-line import/no-unresolved
import { Controller, Get } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { Public } from '../auth/decorators/public.decorator.js';

// eslint-disable-next-line import/no-unresolved
import { StatsService, type StatsOverview } from './stats.service.js';

@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  // @Public:登录页未登录即拉取,展示公开聚合值(集团内网,聚合量级敏感度低)。
  @Public()
  @Get('overview')
  async overview(): Promise<StatsOverview> {
    return this.stats.getOverview();
  }
}
