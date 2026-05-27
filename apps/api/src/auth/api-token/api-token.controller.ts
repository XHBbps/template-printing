import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';
import type { Request } from 'express';
// eslint-disable-next-line import/no-unresolved
import { z } from 'zod';

// eslint-disable-next-line import/no-unresolved
import { AuditLogService } from '../../audit/audit-log.service.js';
// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../../prisma/prisma.service.js';
// eslint-disable-next-line import/no-unresolved
import { isExternal } from '../account-kind.js';
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
  constructor(
    private readonly svc: ApiTokenService,
    private readonly audit: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

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
    @Req() req: Request,
  ): Promise<{ plaintext: string; record: ApiTokenSummary }> {
    const parsed = CreateBodySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const u = await this.prisma.user.findUnique({
      where: { id: me.sub },
      select: { larkOpenId: true, role: true },
    });
    if (!u || isExternal(u)) throw new ForbiddenException('external_account_forbidden');
    const result = await this.svc.create(me.sub, parsed.data.name.trim());
    void this.audit.log({
      actor: { id: me.sub, name: null },
      action: 'token.create',
      resourceType: 'api_token',
      resourceId: result.record.id,
      details: { name: result.record.name, prefix: result.record.prefix },
      request: req,
    });
    return result;
  }

  /** 吊销 token（软删） */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentUser() me: JwtClaims,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    try {
      await this.svc.revoke(me.sub, id);
    } catch (e) {
      // 不泄露存在性 — service 抛 'not_found' 时一律返回 404
      if ((e as Error).message === 'not_found') throw new NotFoundException();
      throw e;
    }
    void this.audit.log({
      actor: { id: me.sub, name: null },
      action: 'token.revoke',
      resourceType: 'api_token',
      resourceId: id,
      request: req,
    });
  }
}
