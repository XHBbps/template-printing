/* eslint-disable import/no-unresolved */
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
/* eslint-enable import/no-unresolved */

// eslint-disable-next-line import/no-unresolved
import { Roles } from '../auth/guards/roles.guard.js';

// eslint-disable-next-line import/no-unresolved
import { AuditLogService } from './audit-log.service.js';

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().trim().min(1).max(120).optional(),
  actorId: z.string().trim().min(1).max(64).optional(),
  resourceType: z.string().trim().min(1).max(64).optional(),
  resourceId: z.string().trim().min(1).max(64).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

/**
 * iter 32 T1+：审计日志查询端点（仅 admin / emergency_admin 可见）。
 */
@Controller('audit-logs')
@Roles('admin', 'emergency_admin')
export class AuditLogController {
  constructor(private readonly svc: AuditLogService) {}

  @Get()
  async list(@Query() rawQuery: unknown) {
    const parsed = ListQuery.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const q = parsed.data;
    return this.svc.list({
      page: q.page,
      pageSize: q.pageSize,
      action: q.action ?? null,
      actorId: q.actorId ?? null,
      resourceType: q.resourceType ?? null,
      resourceId: q.resourceId ?? null,
      from: q.from ? new Date(q.from) : null,
      to: q.to ? new Date(q.to) : null,
    });
  }

  @Get('actions')
  async actions(): Promise<{ items: string[] }> {
    return { items: await this.svc.distinctActions() };
  }
}
