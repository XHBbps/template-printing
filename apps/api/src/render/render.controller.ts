import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  BadRequestException,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { z } from 'zod';

// eslint-disable-next-line import/no-unresolved
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
// eslint-disable-next-line import/no-unresolved
import type { JwtClaims } from '../auth/jwt/jwt.service.js';

// eslint-disable-next-line import/no-unresolved
import { RenderService } from './render.service.js';

const EnqueueDto = z.object({
  templateId: z.string().min(1),
  data: z.record(z.unknown()).default({}),
  formats: z.array(z.enum(['pdf', 'png'])).optional(),
  callbackUrl: z.string().url().optional(),
});

@Controller('render')
export class RenderController {
  constructor(private readonly svc: RenderService) {}

  @Post()
  async enqueue(
    @CurrentUser() me: JwtClaims,
    @Body() rawBody: unknown,
  ): Promise<{ jobId: string; status: string }> {
    const parsed = EnqueueDto.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.svc.enqueue(me.sub, parsed.data);
  }

  @Get(':jobId')
  async get(@Param('jobId') jobId: string): Promise<{
    jobId: string;
    status: string;
    pdfUrl: string | null;
    pngUrl: string | null;
    errorMsg: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }> {
    return this.svc.get(jobId);
  }
}
