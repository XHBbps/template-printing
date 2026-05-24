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
}
