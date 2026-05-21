import { Controller, Get } from '@nestjs/common';

@Controller('healthz')
export class HealthController {
  private readonly startedAt = Date.now();

  @Get()
  check(): { ok: true; uptime: number; version: string } {
    return {
      ok: true,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      version: process.env.APP_VERSION ?? 'dev',
    };
  }
}
