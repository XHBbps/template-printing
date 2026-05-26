// eslint-disable-next-line import/no-unresolved
import { Injectable } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { PrismaService } from '../prisma/prisma.service.js';

export interface StatsOverview {
  windowDays: number;
  monthlyRenders: number; // 近30天全部 render_jobs(任意 status)
  p50LatencyMs: number | null; // 近30天 done 任务渲染耗时中位数;无样本 → null
  successRate: number | null; // done/(done+failed);分母0 → null;取值 0..1
}

@Injectable()
export class StatsService {
  private static readonly WINDOW_DAYS = 30;
  private static readonly TTL_MS = 60_000;
  private cache: { data: StatsOverview; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<StatsOverview> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < StatsService.TTL_MS) return this.cache.data;
    const since = new Date(now - StatsService.WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const data = await this.computeOverview(since);
    this.cache = { data, at: now };
    return data;
  }

  // since 作为窗口下界(可注入,便于测试 null 路径);windowDays 契约固定 30。
  async computeOverview(since: Date): Promise<StatsOverview> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        monthly_renders: bigint;
        done_count: bigint;
        failed_count: bigint;
        p50_ms: number | null;
      }>
    >`
      SELECT
        count(*)::bigint AS monthly_renders,
        count(*) FILTER (WHERE status = 'done')::bigint AS done_count,
        count(*) FILTER (WHERE status = 'failed')::bigint AS failed_count,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
        ) FILTER (
          WHERE status = 'done' AND started_at IS NOT NULL AND completed_at IS NOT NULL
        ) AS p50_ms
      FROM render_jobs
      WHERE created_at >= ${since}
    `;
    const r = rows[0];
    const done = Number(r?.done_count ?? 0n);
    const failed = Number(r?.failed_count ?? 0n);
    const denom = done + failed;
    return {
      windowDays: StatsService.WINDOW_DAYS,
      monthlyRenders: Number(r?.monthly_renders ?? 0n),
      p50LatencyMs: r?.p50_ms == null ? null : Math.round(Number(r.p50_ms)),
      successRate: denom === 0 ? null : done / denom,
    };
  }
}
