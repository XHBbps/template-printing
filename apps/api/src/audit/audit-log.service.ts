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

export interface AuditLogListArgs {
  page: number;
  pageSize: number;
  action?: string | null;
  actorId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  from?: Date | null;
  to?: Date | null;
}

export interface AuditLogItem {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

/**
 * iter 32 T1：审计日志服务（who did what when）。
 *
 * 写入：fire-and-forget — 调用方不 await（或 await 但不抛），DB 写入异常仅
 * Logger.warn，不影响业务路径。
 *
 * 查询：admin-only `list()`，支持 action / actorId / resourceType / resourceId
 * + 日期范围过滤，分页返回 items + total。
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

  async list(args: AuditLogListArgs): Promise<{
    items: AuditLogItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const pageSize = Math.min(Math.max(args.pageSize, 1), 100);
    const page = Math.max(args.page, 1);
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};
    if (args.action) where.action = args.action;
    if (args.actorId) where.actorId = args.actorId;
    if (args.resourceType) where.resourceType = args.resourceType;
    if (args.resourceId) where.resourceId = args.resourceId;
    if (args.from || args.to) {
      const range: Record<string, Date> = {};
      if (args.from) range.gte = args.from;
      if (args.to) range.lte = args.to;
      where.createdAt = range;
    }

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: where as Prisma.AuditLogWhereInput,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where: where as Prisma.AuditLogWhereInput }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        actorId: r.actorId,
        actorName: r.actorName,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        details: r.details,
        ip: r.ip,
        userAgent: r.userAgent,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async distinctActions(): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    return rows.map((r) => r.action);
  }
}
