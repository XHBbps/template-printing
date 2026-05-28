import { promises as fs } from 'fs';
import * as path from 'path';

// eslint-disable-next-line import/no-unresolved
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line import/no-unresolved
import { Cron, CronExpression } from '@nestjs/schedule';
// eslint-disable-next-line import/no-unresolved
import { fetch } from 'undici';

// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';
// eslint-disable-next-line import/no-unresolved
import { FileSigService } from '../uploads/file-sig.service.js';

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '/storage';
const RENDER_DIR = path.join(STORAGE_ROOT, 'uploads', 'render');

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileSig: FileSigService,
  ) {}

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

  /**
   * iter 32 T4：僵尸 processing job 对账。
   *
   * 每 5 分钟扫一次：找所有 status='processing' 且 startedAt < cutoff 的行，
   * 标记为 failed / stuck_timeout 并 best-effort 补发 webhook 回调。
   * 阈值默认 10 min（RENDER_STUCK_TIMEOUT_MIN），远大于 bullmq 重试窗口，
   * 不会误触正在合法重试中的 job（worker 每次 markProcessing 会刷 startedAt）。
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileStuckJobs(): Promise<void> {
    const min = Number(process.env.RENDER_STUCK_TIMEOUT_MIN ?? 10);
    if (!Number.isFinite(min) || min <= 0) return;
    const cutoff = new Date(Date.now() - min * 60_000);
    const stuck = await this.prisma.renderJob.findMany({
      where: { status: 'processing', startedAt: { lt: cutoff } },
      select: { id: true, callbackUrl: true },
    });
    if (stuck.length === 0) return;
    this.log.warn(`reconcile: ${stuck.length} stuck job(s) → failed`);
    for (const job of stuck) {
      await this.prisma.renderJob.update({
        where: { id: job.id },
        data: { status: 'failed', errorMsg: 'stuck_timeout', completedAt: new Date() },
      });
      await this.sendStuckCallback(job.id, job.callbackUrl);
    }
  }

  /** 与 worker webhook.ts 对齐：payload 形状 + callbackStatus + 10s 超时。 */
  private async sendStuckCallback(jobId: string, callbackUrl: string | null): Promise<void> {
    if (!callbackUrl) return;
    const payload = {
      jobId,
      status: 'failed',
      pdfUrl: this.fileSig.signUrl(null),
      pngUrl: this.fileSig.signUrl(null),
      errorMsg: 'stuck_timeout',
    };
    try {
      const res = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      await this.prisma.renderJob.update({
        where: { id: jobId },
        data: { callbackStatus: res.ok ? 'sent' : 'failed' },
      });
    } catch {
      await this.prisma.renderJob
        .update({ where: { id: jobId }, data: { callbackStatus: 'failed' } })
        .catch(() => {});
    }
  }

  /**
   * P1(系统 review):清理无任何模板引用的孤儿上传图片,防 /storage/uploads 无限增长。
   * 内容寻址(sha256 文件名)→ 引用集 = templates.data + template_versions.data 中所有 /uploads/<file>。
   * 仅删「不在引用集 且 mtime 早于 UPLOAD_ORPHAN_GRACE_DAYS(默认7,0=关)」的顶层文件;
   * render/ 子目录(渲染产物)由 cleanupOldOutputs 负责,这里按"仅顶层文件"自然排除。
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanupOrphanUploads(): Promise<void> {
    const graceDays = Number(process.env.UPLOAD_ORPHAN_GRACE_DAYS ?? 7);
    if (!Number.isFinite(graceDays) || graceDays <= 0) {
      this.log.log('UPLOAD_ORPHAN_GRACE_DAYS <= 0, skip orphan-uploads cleanup');
      return;
    }
    const uploadsDir = path.join(STORAGE_ROOT, 'uploads');
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(uploadsDir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    const files = entries.filter((d) => d.isFile()).map((d) => d.name); // 顶层文件,排除 render/ 子目录
    if (files.length === 0) return;

    // 引用集:扫 templates.data + template_versions.data 的 /uploads/<file>
    const rows = await this.prisma.$queryRaw<Array<{ data: string }>>`
      SELECT data::text AS data FROM templates WHERE data::text LIKE '%/uploads/%'
      UNION ALL
      SELECT data::text AS data FROM template_versions WHERE data::text LIKE '%/uploads/%'`;
    const referenced = new Set<string>();
    const re = /\/uploads\/([A-Za-z0-9._-]+)/g;
    for (const r of rows) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(r.data)) !== null) referenced.add(m[1]!);
    }

    const cutoff = Date.now() - graceDays * 86400 * 1000;
    let deleted = 0;
    for (const name of files) {
      if (referenced.has(name)) continue;
      const full = path.join(uploadsDir, name);
      try {
        const st = await fs.stat(full);
        if (st.mtimeMs >= cutoff) continue; // 宽限期内(刚上传未存模板)
        await fs.unlink(full);
        deleted++;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT')
          this.log.warn(`orphan unlink ${full} failed: ${(e as Error).message}`);
      }
    }
    this.log.log(
      `orphan-uploads cleanup: ${deleted} unreferenced file(s) removed (grace ${graceDays}d)`,
    );
  }
}
