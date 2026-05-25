// eslint-disable-next-line import/no-unresolved
import { Controller, Get, Header } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { SkipThrottle } from '@nestjs/throttler';

// eslint-disable-next-line import/no-unresolved
import { Public } from '../auth/decorators/public.decorator.js';

// eslint-disable-next-line import/no-unresolved
import { MetricsService } from './metrics.service.js';

/**
 * GET /metrics — Prometheus exposition format。
 * @Public + @SkipThrottle —— 给 ops scrape，不需要鉴权也不该被限流。
 * 生产建议在 Nginx 层加 IP whitelist 限制访问。
 */
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async expose(): Promise<string> {
    return this.metrics.expose();
  }
}
