import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  // eslint-disable-next-line import/no-unresolved
} from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { Queue } from 'bullmq';
// eslint-disable-next-line import/no-unresolved
import IORedis from 'ioredis';

// eslint-disable-next-line import/no-unresolved
import { AuditLogService } from '../audit/audit-log.service.js';
// eslint-disable-next-line import/no-unresolved
import { MetricsService } from '../metrics/metrics.service.js';
// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';
// eslint-disable-next-line import/no-unresolved
import { FileSigService } from '../uploads/file-sig.service.js';

export interface EnqueueArgs {
  templateId: string;
  data: Record<string, unknown>;
  formats?: ('pdf' | 'png')[];
  callbackUrl?: string;
  version?: number;
}

@Injectable()
export class RenderService {
  private readonly queue: Queue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileSig: FileSigService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
  ) {
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
    const tpl = await this.prisma.template.findFirst({
      where,
      select: { id: true, publishedVersion: true },
    });
    if (!tpl) throw new NotFoundException('template_not_found');

    // 解析渲染版本：传了用指定版本，否则用最新已发布版
    let resolvedVersion: number;
    if (args.version != null) {
      const ver = await this.prisma.templateVersion.findUnique({
        where: { templateId_version: { templateId: args.templateId, version: args.version } },
        select: { version: true },
      });
      if (!ver) throw new NotFoundException('template_version_not_found');
      resolvedVersion = ver.version;
    } else {
      if (tpl.publishedVersion == null) {
        throw new BadRequestException('no_published_version');
      }
      resolvedVersion = tpl.publishedVersion;
    }

    // iter 31 T4：用户日配额（系统调用 ownerId=null 不计入任何用户配额）
    if (ownerId) {
      await this.checkDailyQuota(ownerId);
    }

    const formats = args.formats?.length ? args.formats : (['pdf', 'png'] as const);
    const job = await this.prisma.renderJob.create({
      data: {
        templateId: args.templateId,
        data: args.data as object,
        formats: [...formats],
        status: 'pending',
        callbackUrl: args.callbackUrl ?? null,
        templateVersion: resolvedVersion,
      },
    });
    await this.queue.add(
      'render',
      { jobId: job.id, ownerId: ownerId ?? null },
      {
        jobId: job.id,
        // iter 31 T2：渲染失败按指数退避重试 3 次（2s / 4s / 8s）
        // 永久错误（template_not_found / schema 错误等）worker 会主动抛
        // UnrecoverableError 跳过剩余 attempts
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 1000 },
      },
    );

    // iter 32 T1：审计日志（系统调用 ownerId=null 不记，由飞书 webhook 自己记）
    if (ownerId) {
      void this.audit.log({
        actor: { id: ownerId, name: null },
        action: 'render.enqueue',
        resourceType: 'render_job',
        resourceId: job.id,
        details: { templateId: args.templateId, formats: [...formats] },
      });
    }

    // iter 32 T3：metrics — 入队计数（source 由调用方决定，目前仅 api 路径）
    this.metrics.renderJobs.inc({ status: 'enqueued', source: ownerId ? 'api' : 'system' });

    return { jobId: job.id, status: job.status };
  }

  async get(
    jobId: string,
    user: { sub: string; role: string },
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
    const isAdmin = user.role === 'admin' || user.role === 'emergency_admin';
    const job = await this.prisma.renderJob.findUnique({
      where: { id: jobId },
      include: { template: { select: { ownerId: true } } },
    });
    if (!job) throw new NotFoundException('job_not_found');
    // V1 IDOR fix：非 admin 只能读自己 owner 模板触发的 job；不泄露存在性（404 not 403）
    if (!isAdmin && job.template?.ownerId !== user.sub) {
      throw new NotFoundException('job_not_found');
    }
    return {
      jobId: job.id,
      status: job.status,
      pdfUrl: this.fileSig.signUrl(job.pdfUrl),
      pngUrl: this.fileSig.signUrl(job.pngUrl),
      errorMsg: job.errorMsg,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      cleanedAt: job.cleanedAt,
      templateVersion: job.templateVersion,
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
      cleanedAt: Date | null;
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
          cleanedAt: r.cleanedAt,
          durationMs,
          pdfUrl: this.fileSig.signUrl(r.pdfUrl),
          pngUrl: this.fileSig.signUrl(r.pngUrl),
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

  /**
   * iter 31 T4：单用户日配额。超限抛 HttpException(429) 含 QUOTA_EXCEEDED
   * + 已用 / 上限 / 重置时间，前端可显示给用户。
   *
   * 计数维度：当日（本地 00:00 起）创建的 render_jobs，按 template.ownerId 归属。
   * Lark webhook（ownerId=null）跳过此检查。
   */
  private async checkDailyQuota(ownerId: string): Promise<void> {
    const limit = Number(process.env.RENDER_QUOTA_PER_USER_DAILY ?? 200);
    if (!Number.isFinite(limit) || limit <= 0) return; // 0 / 负 = 关闭配额

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const used = await this.prisma.renderJob.count({
      where: {
        template: { ownerId },
        createdAt: { gte: start },
      },
    });
    if (used >= limit) {
      const resetAt = new Date(start);
      resetAt.setDate(resetAt.getDate() + 1);
      // iter 32 T3：metrics — 记录配额超限事件
      this.metrics.renderQuotaExceeded.inc();
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'QUOTA_EXCEEDED',
            message: `每日渲染配额已用完（${used}/${limit}）`,
            used,
            limit,
            resetAt: resetAt.toISOString(),
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
