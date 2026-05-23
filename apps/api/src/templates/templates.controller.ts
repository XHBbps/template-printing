import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { TemplatesService } from './templates.service.js';

const CreateDto = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  data: z.unknown(),
});

const UpdateDto = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  data: z.unknown().optional(),
});

@Controller('templates')
export class TemplatesController {
  constructor(private readonly svc: TemplatesService) {}

  @Get()
  async list(@CurrentUser() me: JwtClaims) {
    return this.svc.list(me.sub);
  }

  @Get(':id')
  async get(@CurrentUser() me: JwtClaims, @Param('id') id: string) {
    return this.svc.get(me.sub, id);
  }

  @Post()
  async create(@CurrentUser() me: JwtClaims, @Body() rawBody: unknown) {
    const parsed = CreateDto.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.svc.create(me.sub, parsed.data);
  }

  @Patch(':id')
  async update(@CurrentUser() me: JwtClaims, @Param('id') id: string, @Body() rawBody: unknown) {
    const parsed = UpdateDto.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.svc.update(me.sub, id, parsed.data);
  }

  @Delete(':id')
  async remove(@CurrentUser() me: JwtClaims, @Param('id') id: string): Promise<{ ok: true }> {
    await this.svc.remove(me.sub, id);
    return { ok: true };
  }
}
