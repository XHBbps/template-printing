import {
  Injectable,
  NotFoundException,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { Queue } from 'bullmq';
// eslint-disable-next-line import/no-unresolved
import IORedis from 'ioredis';

// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';

export interface EnqueueArgs {
  templateId: string;
  data: Record<string, unknown>;
  formats?: ('pdf' | 'png')[];
  callbackUrl?: string;
}

@Injectable()
export class RenderService {
  private readonly queue: Queue;

  constructor(private readonly prisma: PrismaService) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.queue = new Queue('render', {
      connection: new IORedis(url, { maxRetriesPerRequest: null }),
    });
  }

  async enqueue(
    ownerId: string | null,
    args: EnqueueArgs,
  ): Promise<{ jobId: string; status: string }> {
    // 校验 template 存在 + ownership（ownerId=null 表示系统调用，跳过 ownership 检查）
    const where = ownerId ? { id: args.templateId, ownerId } : { id: args.templateId };
    const tpl = await this.prisma.template.findFirst({ where });
    if (!tpl) throw new NotFoundException('template_not_found');

    const formats = args.formats?.length ? args.formats : (['pdf', 'png'] as const);
    const job = await this.prisma.renderJob.create({
      data: {
        templateId: args.templateId,
        data: args.data as object,
        formats: [...formats],
        status: 'pending',
        callbackUrl: args.callbackUrl ?? null,
      },
    });
    await this.queue.add('render', { jobId: job.id }, { jobId: job.id });
    return { jobId: job.id, status: job.status };
  }

  async get(jobId: string): Promise<{
    jobId: string;
    status: string;
    pdfUrl: string | null;
    pngUrl: string | null;
    errorMsg: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }> {
    const job = await this.prisma.renderJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('job_not_found');
    return {
      jobId: job.id,
      status: job.status,
      pdfUrl: job.pdfUrl,
      pngUrl: job.pngUrl,
      errorMsg: job.errorMsg,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    };
  }

  /**
   * 列出渲染任务（admin 看全部 / 普通用户看自己 owner 的模板触发的）。
   * Source 推断：
   *   有 larkBotSession → 'bot'
   *   有 larkPrintRequest → 'bitable'
   *   都没有 → 'api'
   */
  async listJobs(args: {
    user: { sub: string; role: string };
    page: number;
    pageSize: number;
    status?: string;
    source?: 'bot' | 'bitable' | 'api';
    templateName?: string;
  }): Promise<{
    items: Array<{
      id: string;
      templateId: string;
      templateName: string;
      status: string;
      source: 'bot' | 'bitable' | 'api';
      createdAt: Date;
      completedAt: Date | null;
      durationMs: number | null;
      pdfUrl: string | null;
      pngUrl: string | null;
      errorMsg: string | null;
      data: unknown;
      callbackUrl: string | null;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const isAdmin = args.user.role === 'admin' || args.user.role === 'emergency_admin';
    const pageSize = Math.min(Math.max(args.pageSize, 1), 100);
    const skip = (Math.max(args.page, 1) - 1) * pageSize;

    // 用普通对象拼 where；Prisma 在 findMany 调用时再做类型校验
    const where: Record<string, unknown> = {};
    const templateFilter: Record<string, unknown> = {};
    if (!isAdmin) templateFilter.ownerId = args.user.sub;
    if (args.templateName) {
      templateFilter.name = { contains: args.templateName, mode: 'insensitive' };
    }
    if (Object.keys(templateFilter).length > 0) where.template = templateFilter;
    if (args.status) where.status = args.status;
    if (args.source === 'bot') {
      where.larkBotSession = { isNot: null };
      where.larkPrintRequest = { is: null };
    } else if (args.source === 'bitable') {
      where.larkPrintRequest = { isNot: null };
      where.larkBotSession = { is: null };
    } else if (args.source === 'api') {
      where.larkBotSession = { is: null };
      where.larkPrintRequest = { is: null };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.renderJob.findMany({
        where,
        include: {
          template: { select: { name: true } },
          larkBotSession: { select: { id: true } },
          larkPrintRequest: { select: { id: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip,
      }),
      this.prisma.renderJob.count({ where }),
    ]);

    return {
      items: rows.map((r) => {
        const source: 'bot' | 'bitable' | 'api' = r.larkBotSession
          ? 'bot'
          : r.larkPrintRequest
            ? 'bitable'
            : 'api';
        const durationMs =
          r.completedAt && r.startedAt
            ? r.completedAt.getTime() - r.startedAt.getTime()
            : r.completedAt
              ? r.completedAt.getTime() - r.createdAt.getTime()
              : null;
        return {
          id: r.id,
          templateId: r.templateId,
          templateName: r.template?.name ?? '已删除模板',
          status: r.status,
          source,
          createdAt: r.createdAt,
          completedAt: r.completedAt,
          durationMs,
          pdfUrl: r.pdfUrl,
          pngUrl: r.pngUrl,
          errorMsg: r.errorMsg,
          data: r.data,
          callbackUrl: r.callbackUrl,
        };
      }),
      total,
      page: args.page,
      pageSize,
    };
  }
}
