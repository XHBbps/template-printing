import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  BadRequestException,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';
import type { Request } from 'express';
// eslint-disable-next-line import/no-unresolved
import { z } from 'zod';

// eslint-disable-next-line import/no-unresolved
import { AuditLogService } from '../audit/audit-log.service.js';
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

const ListQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(15),
  search: z.string().trim().max(120).optional(),
  sort: z.enum(['updated', 'name', 'created']).default('created'),
});

@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly svc: TemplatesService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  async list(@CurrentUser() me: JwtClaims, @Query() rawQuery: unknown) {
    const parsed = ListQuery.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const q = parsed.data;
    return this.svc.list(me.sub, {
      offset: q.offset,
      limit: q.limit,
      search: q.search ?? null,
      sort: q.sort,
    });
  }

  @Get(':id/versions')
  async listVersions(@CurrentUser() me: JwtClaims, @Param('id') id: string) {
    return this.svc.listVersions(me.sub, id);
  }

  @Get(':id/versions/:version')
  async getVersion(
    @CurrentUser() me: JwtClaims,
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    const v = Number(version);
    if (!Number.isInteger(v) || v < 1) throw new BadRequestException('invalid_version');
    return this.svc.getVersion(me.sub, id, v);
  }

  @Get(':id')
  async get(@CurrentUser() me: JwtClaims, @Param('id') id: string) {
    return this.svc.get(me.sub, id);
  }

  @Post()
  async create(@CurrentUser() me: JwtClaims, @Body() rawBody: unknown, @Req() req: Request) {
    const parsed = CreateDto.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const tpl = await this.svc.create(me.sub, parsed.data);
    void this.audit.log({
      actor: { id: me.sub, name: null },
      action: 'template.create',
      resourceType: 'template',
      resourceId: tpl.id,
      details: { name: tpl.name },
      request: req,
    });
    return tpl;
  }

  @Patch(':id')
  async update(
    @CurrentUser() me: JwtClaims,
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Req() req: Request,
  ) {
    const parsed = UpdateDto.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const tpl = await this.svc.update(me.sub, id, parsed.data);
    void this.audit.log({
      actor: { id: me.sub, name: null },
      action: 'template.update',
      resourceType: 'template',
      resourceId: id,
      details: { name: parsed.data.name },
      request: req,
    });
    return tpl;
  }

  @Post(':id/publish')
  async publish(@CurrentUser() me: JwtClaims, @Param('id') id: string, @Req() req: Request) {
    const result = await this.svc.publish(me.sub, id);
    void this.audit.log({
      actor: { id: me.sub, name: null },
      action: 'template.publish',
      resourceType: 'template',
      resourceId: id,
      details: { version: result.version },
      request: req,
    });
    return result;
  }

  @Delete(':id')
  async remove(
    @CurrentUser() me: JwtClaims,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    // 先取 name 再删（删后查不到）
    const tpl = await this.svc.get(me.sub, id).catch(() => null);
    await this.svc.remove(me.sub, id);
    void this.audit.log({
      actor: { id: me.sub, name: null },
      action: 'template.delete',
      resourceType: 'template',
      resourceId: id,
      details: { name: tpl?.name ?? null },
      request: req,
    });
    return { ok: true };
  }
}
