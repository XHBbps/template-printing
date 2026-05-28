import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  BadRequestException,
  UseGuards,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { Throttle } from '@nestjs/throttler';
// eslint-disable-next-line import/no-unresolved
import { z } from 'zod';

// eslint-disable-next-line import/no-unresolved
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
// eslint-disable-next-line import/no-unresolved
import { Public } from '../auth/decorators/public.decorator.js';
// eslint-disable-next-line import/no-unresolved
import { ApiAuthGuard } from '../auth/guards/api-auth.guard.js';
// eslint-disable-next-line import/no-unresolved
import type { JwtClaims } from '../auth/jwt/jwt.service.js';

// eslint-disable-next-line import/no-unresolved
import { RenderService } from './render.service.js';

const EnqueueDto = z.object({
  templateId: z.string().min(1),
  data: z.record(z.unknown()).default({}),
  formats: z.array(z.enum(['pdf', 'png'])).optional(),
  callbackUrl: z.string().url().optional(),
  version: z.coerce.number().int().min(1).optional(),
});

// @Public() 跳过全局 JwtAuthGuard + CsrfGuard；ApiAuthGuard 接管鉴权
// （支持 Bearer API token 与 JWT cookie 两路径，详见 api-auth.guard.ts）
@Controller('render')
@Public()
@UseGuards(ApiAuthGuard)
export class RenderController {
  constructor(private readonly svc: RenderService) {}

  // iter 31 T3：override 全局 60/min → 30/min（可 .env 覆盖）。
  // 单用户超限返 429 + Retry-After（throttler 默认行为）
  @Throttle({
    default: { limit: Number(process.env.RENDER_RATE_LIMIT_PER_MIN ?? 30), ttl: 60_000 },
  })
  @Post()
  async enqueue(
    @CurrentUser() me: JwtClaims,
    @Body() rawBody: unknown,
  ): Promise<{ jobId: string; status: string }> {
    const parsed = EnqueueDto.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.svc.enqueue(me.sub, parsed.data);
  }

  @Get('jobs')
  async listJobs(
    @CurrentUser() me: JwtClaims,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('templateName') templateName?: string,
  ): Promise<ReturnType<RenderService['listJobs']>> {
    const s = source === 'bot' || source === 'bitable' || source === 'api' ? source : undefined;
    return this.svc.listJobs({
      user: { sub: me.sub, role: me.role },
      page: Number(page),
      pageSize: Number(pageSize),
      status,
      source: s,
      templateName,
    });
  }

  @Get(':jobId')
  async get(
    @CurrentUser() me: JwtClaims,
    @Param('jobId') jobId: string,
  ): Promise<{
    jobId: string;
    status: string;
    pdfUrl: string | null;
    pngUrl: string | null;
    errorMsg: string | null;
    createdAt: Date;
    completedAt: Date | null;
    cleanedAt: Date | null;
    templateVersion: number | null;
  }> {
    return this.svc.get(jobId, { sub: me.sub, role: me.role });
  }
}
