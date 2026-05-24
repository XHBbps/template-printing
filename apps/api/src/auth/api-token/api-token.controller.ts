import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { z } from 'zod';

// eslint-disable-next-line import/no-unresolved
import { CurrentUser } from '../decorators/current-user.decorator.js';
// eslint-disable-next-line import/no-unresolved
import type { JwtClaims } from '../jwt/jwt.service.js';

// eslint-disable-next-line import/no-unresolved
import { ApiTokenService, type ApiTokenSummary } from './api-token.service.js';

const CreateBodySchema = z.object({
  name: z.string().min(1).max(64),
});

@Controller('users/me/api-tokens')
export class ApiTokenController {
  constructor(private readonly svc: ApiTokenService) {}

  /** 列出当前用户的 token（含已吊销） */
  @Get()
  async list(@CurrentUser() me: JwtClaims): Promise<{ items: ApiTokenSummary[] }> {
    const items = await this.svc.listByUser(me.sub);
    return { items };
  }

  /** 创建一个 token — 返回 plaintext（仅这一次） + record */
  @Post()
  @HttpCode(HttpStatus.OK)
  async create(
    @CurrentUser() me: JwtClaims,
    @Body() raw: unknown,
  ): Promise<{ plaintext: string; record: ApiTokenSummary }> {
    const parsed = CreateBodySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.svc.create(me.sub, parsed.data.name.trim());
  }

  /** 吊销 token（软删） */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@CurrentUser() me: JwtClaims, @Param('id') id: string): Promise<void> {
    try {
      await this.svc.revoke(me.sub, id);
    } catch (e) {
      // 不泄露存在性 — service 抛 'not_found' 时一律返回 404
      if ((e as Error).message === 'not_found') throw new NotFoundException();
      throw e;
    }
  }
}
