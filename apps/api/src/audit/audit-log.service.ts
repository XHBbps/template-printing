// eslint-disable-next-line import/no-unresolved
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { Prisma } from '@prisma/client';
import type { Request } from 'express';

// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditLogActor {
  id: string;
  name: string | null;
}

export interface AuditLogArgs {
  actor: AuditLogActor | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
  request?: Request;
}

/**
 * iter 32 T1：审计日志服务（who did what when）。
 *
 * 设计：fire-and-forget — 调用方不 await（或 await 但不抛），DB 写入异常仅
 * Logger.warn，不影响业务路径。
 *
 * 使用：
 *   void this.audit.log({ actor: { id, name }, action: 'template.delete',
 *                          resourceType: 'template', resourceId: id,
 *                          details: { name }, request });
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(args: AuditLogArgs): Promise<void> {
    try {
      const ip = args.request?.ip ?? null;
      const userAgent = args.request?.headers['user-agent'] ?? null;
      await this.prisma.auditLog.create({
        data: {
          actorId: args.actor?.id ?? null,
          actorName: args.actor?.name ?? null,
          action: args.action,
          resourceType: args.resourceType ?? null,
          resourceId: args.resourceId ?? null,
          details: args.details ? (args.details as Prisma.InputJsonValue) : Prisma.JsonNull,
          ip,
          userAgent: typeof userAgent === 'string' ? userAgent : null,
        },
      });
    } catch (e) {
      // 不抛 — 审计失败不应影响业务
      this.logger.warn(`audit log failed: ${(e as Error).message} (action=${args.action})`);
    }
  }
}
