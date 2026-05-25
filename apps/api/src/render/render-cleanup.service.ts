import { promises as fs } from 'fs';
import * as path from 'path';

// eslint-disable-next-line import/no-unresolved
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { Cron, CronExpression } from '@nestjs/schedule';

// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '/storage';
const RENDER_DIR = path.join(STORAGE_ROOT, 'render');

/**
 * iter 31 T5：自动清理 N 天前的渲染输出文件，防止磁盘打满。
 *
 * - 保留 DB 记录（render_jobs 行不删），仅清磁盘文件 + 标记 cleaned_at；
 *   渲染日志页对 cleanedAt != null 的 job 不显示下载按钮，但状态 / 触发时间
 *   等审计信息保留。
 * - 默认每日凌晨 3 点（容器 TZ）触发。
 * - RENDER_CLEANUP_DAYS=0 关闭清理（dev / 测试用）。
 */
@Injectable()
export class RenderCleanupService {
  private readonly log = new Logger(RenderCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupOldOutputs(): Promise<void> {
    const days = Number(process.env.RENDER_CLEANUP_DAYS ?? 30);
    if (!Number.isFinite(days) || days <= 0) {
      this.log.log('RENDER_CLEANUP_DAYS <= 0, skipping cleanup');
      return;
    }
    const cutoff = new Date(Date.now() - days * 86400 * 1000);
    const oldJobs = await this.prisma.renderJob.findMany({
      where: {
        createdAt: { lt: cutoff },
        cleanedAt: null,
        status: { in: ['done', 'failed'] },
      },
      select: { id: true, pdfUrl: true, pngUrl: true },
    });
    if (oldJobs.length === 0) {
      this.log.log(`cleanup: no jobs older than ${days}d`);
      return;
    }

    let deletedFiles = 0;
    for (const job of oldJobs) {
      // pdfUrl 形如 /uploads/render/<id>.pdf — 仅取文件名拼到本地
      for (const url of [job.pdfUrl, job.pngUrl]) {
        if (!url) continue;
        const filename = path.basename(url.split('?')[0] ?? '');
        if (!filename) continue;
        const full = path.join(RENDER_DIR, filename);
        try {
          await fs.unlink(full);
          deletedFiles++;
        } catch (e) {
          // ENOENT 是常见的（文件已被人手动清理）— 不算错误
          const code = (e as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') {
            this.log.warn(`unlink ${full} failed: ${(e as Error).message}`);
          }
        }
      }
    }

    await this.prisma.renderJob.updateMany({
      where: { id: { in: oldJobs.map((j) => j.id) } },
      data: { cleanedAt: new Date(), pdfUrl: null, pngUrl: null },
    });

    this.log.log(
      `cleanup done: ${oldJobs.length} jobs marked cleaned, ${deletedFiles} files removed (cutoff: ${cutoff.toISOString()})`,
    );
  }
}
